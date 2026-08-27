'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type StoreApp = { id:string; name:string; title:string; description:string; tags:string[]; type:string; website:string; github:string; document:string };
type FormField = { envKey:string; label:string; default:string|number; required:boolean; type:string; rule:string };
type Detail = StoreApp & { version:string; formFields:FormField[]; compose:string };
type JobState = { id:string; status:'running'|'done'|'error'; output:string };

export default function StorePage({ token, notify, onNavigate }:{ token:string;notify:(type:'ok'|'err',message:string)=>void;onNavigate:(view:string)=>void }) {
  const [apps,setApps] = useState<StoreApp[]|null>(null);
  const [source,setSource] = useState('');
  const [mirror,setMirror] = useState('');
  const [error,setError] = useState('');
  const [installed,setInstalled] = useState<string[]>([]);
  const [filter,setFilter] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [detail,setDetail] = useState<Detail|null>(null);
  const [params,setParams] = useState<Record<string,string>>({});
  const [rendered,setRendered] = useState<{compose:string;env:string}|null>(null);
  const [job,setJob] = useState<JobState|null>(null);
  const [sourceEdit,setSourceEdit] = useState<{repo:string;branch:string;mirror:string}|null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const locked = (key='') => !token || (Boolean(busy) && (busyKey === '' || busyKey === key));

  const load = useCallback(async () => {
    setBusy('读取商店');setBusyKey('');
    try {
      const storeRes = await fetch(`${__WPANEL_API__}/api/store/apps`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const storeData = await storeRes.json() as {apps?:StoreApp[];source?:string;mirror?:string;error?:string};
      if (!storeRes.ok) throw new Error(storeData.error || '商店读取失败');
      setApps(storeData.apps || []);setSource(storeData.source || '');setMirror(storeData.mirror ?? '');setError('');
      try {
        const composeRes = await fetch(`${__WPANEL_API__}/api/compose/projects`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
        const composeData = await composeRes.json() as {projects?:{name:string}[]};
        if (composeRes.ok) setInstalled((composeData.projects || []).map((project) => project.name)); else setInstalled([]);
      } catch { setInstalled([]); }
    } catch (reason) { setError(reason instanceof Error?reason.message:'读取失败');setApps(null); }
    finally { setBusy('');setBusyKey(''); }
  },[token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面拉取一次
    if (token) load();
  },[token,load]);

  // 安装任务进度轮询
  useEffect(() => {
    if (!job || job.status !== 'running' || !token) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${__WPANEL_API__}/api/store/job/${job.id}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
        const data = await response.json() as {status?:JobState['status'];output?:string;error?:string};
        if (!response.ok) { setJob((current) => current ? { ...current,status:'error',output:current.output+`\n${data.error||'任务查询失败'}` } : current); return; }
        setJob((current) => current && current.id === job.id ? { ...current, status:data.status || 'running', output:data.output || '' } : current);
      } catch { /* 单次轮询失败忽略 */ }
    }, 1000);
    return () => window.clearInterval(timer);
  },[job,token]);

  useEffect(() => { if (job && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; },[job?.output]);

  // 参数变化后防抖渲染最终 compose（与安装共用服务端渲染逻辑，所见即所装）
  useEffect(() => {
    if (!detail || job) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${__WPANEL_API__}/api/store/render`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({id:detail.id,params})});
        const result = await response.json() as {compose?:string;env?:string;error?:string};
        if (response.ok) setRendered({ compose:result.compose || '', env:result.env || '' });
      } catch { /* 预览失败静默，安装时会重新校验 */ }
    }, 500);
    return () => window.clearTimeout(timer);
  },[detail,params,job,token]);

  async function openInstall(app:StoreApp) {
    setBusy(`读取 ${app.name}`);setBusyKey(app.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/app/${encodeURIComponent(app.id)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as Detail & {error?:string};
      if (!response.ok) throw new Error(result.error || '详情读取失败');
      const initial:Record<string,string> = {};
      for (const field of result.formFields) initial[field.envKey] = String(field.default ?? '');
      setParams(initial);setDetail(result);setRendered(null);setJob(null);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function install() {
    if (!detail) return;
    setBusy(`提交安装`);setBusyKey(detail.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/install`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({id:detail.id,params})});
      const result = await response.json() as {jobId?:string;error?:string};
      if (!response.ok || !result.jobId) throw new Error(result.error || '安装任务提交失败');
      setBusy('');setBusyKey('');
      setJob({ id:result.jobId, status:'running', output:'' });
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'安装失败');setBusy('');setBusyKey(''); }
  }

  async function uninstall(app:StoreApp) {
    if (!window.confirm(`卸载 ${app.name}？将停止并移除其容器（卷数据默认保留）。`)) return;
    if (!window.confirm('再次确认：卸载后编排目录中的项目文件也会删除。')) return;
    setBusy(`卸载 ${app.name}`);setBusyKey(app.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/uninstall`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({id:app.id})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '卸载失败');
      notify('ok',`${app.name} 已卸载`);await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'卸载失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function saveSource() {
    if (!sourceEdit) return;
    setBusy('保存设置');setBusyKey('source');
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/source`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(sourceEdit)});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '保存失败');
      setSourceEdit(null);setMirror(sourceEdit.mirror.trim());notify('ok','商店设置已保存');
      setApps(null);await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'保存失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  if (!token) return <section className="file-wrap"><div className="empty-state">控制会话尚未就绪，稍候自动重试。</div></section>;

  const list = (apps || []).filter((app) => !filter.trim() || `${app.name} ${app.title} ${app.tags.join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const jobDone = job?.status === 'done';

  return <section className="file-wrap">
    <div className="section-title"><div><h2>应用商店</h2><p title={source}>{source ? `模板源：${source}` : '兼容 1Panel 应用商店格式'}</p></div>
      <div className="section-tools"><input aria-label="搜索应用" value={filter} onChange={(event)=>setFilter(event.target.value)} placeholder="搜索应用"/>
        <button className="mini-button ghost" onClick={()=>{const parts=source.split('@');setSourceEdit({ repo:parts[0]||'https://github.com/1Panel-dev/appstore', branch:parts[1]||'main', mirror });}}>商店设置</button>
        <button className="mini-button ghost" disabled={locked('refresh')} onClick={async()=>{setBusy('更新模板源');setBusyKey('refresh');try{const r=await fetch(`${__WPANEL_API__}/api/store/refresh`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:'{}'});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||'更新失败');notify('ok','模板源已更新');await load();}catch(reason){notify('err',reason instanceof Error?reason.message:'更新失败')}finally{setBusy('');setBusyKey('')}}}>更新源</button>
        <button className="mini-button ghost" onClick={()=>load()}>刷新</button></div></div>

    {busy&&<span className="working">{busy}…</span>}
    {error&&<div className="empty-state" style={{marginBottom:14}}>{error}{apps===null&&'——首次使用会下载模板仓库（约 200MB），可能需要一两分钟'}</div>}

    <div className="store-grid">
      {list.map((app)=>{
        const isInstalled = installed.includes(app.id);
        return <article className="store-card" key={app.id}>
          <div className="store-head">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地商店 logo 小图，不适用 next/image */}
            <img className="store-logo" src={`${__WPANEL_API__}/api/store/logo/${encodeURIComponent(app.id)}`} alt="" loading="lazy" onError={(event)=>{event.currentTarget.style.visibility='hidden';}}/>
            <div className="store-name"><strong title={app.name}>{app.name}</strong><small>{app.tags.slice(0,3).join(' · ')}</small></div>
            {isInstalled&&<span className="tag online">已安装</span>}
          </div>
          <p className="store-desc" title={app.title}>{app.title||app.description||'—'}</p>
          <div className="store-actions">
            {!isInstalled&&<button className="mini-button" disabled={locked(app.id)} onClick={()=>openInstall(app)}>安装</button>}
            {isInstalled&&<button className="mini-button ghost" disabled={locked(app.id)} onClick={()=>uninstall(app)}>卸载</button>}
            {app.website&&<a className="mini-button ghost store-link" href={app.website} target="_blank" rel="noreferrer">官网</a>}
          </div>
        </article>;
      })}
      {apps&&list.length===0&&<div className="empty-state" style={{gridColumn:'1/-1'}}>没有匹配的应用</div>}
    </div>

    {detail&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{if(!job||job.status==='error')setDetail(null);}}><section className="file-modal store-modal" role="dialog" aria-modal="true" aria-label={`安装 ${detail.name}`} onMouseDown={(event)=>event.stopPropagation()}>
      {job===null?<><header><div><small>{detail.name} v{detail.version} · 安装参数{mirror?` · 镜像加速：${mirror}`:''}</small><h2>{detail.title}</h2></div>
        <div className="fm-tools"><button className="fm-btn" onClick={()=>setDetail(null)}>取消</button><button className="fm-btn primary" disabled={Boolean(busy)} onClick={install}>开始安装</button></div></header>
      <div className="store-modal-body">
        <div className="store-form">
          {detail.formFields.length===0&&<small className="card-empty">该应用没有可配置参数，直接确认安装即可。</small>}
          {detail.formFields.map(field=><label className="store-field" key={field.envKey}>
            <span>{field.label}{field.required&&<i style={{color:'var(--bad)'}}>*</i>}<small> {field.envKey}</small></span>
            <input value={params[field.envKey] ?? ''} onChange={(event)=>setParams(current=>({...current,[field.envKey]:event.target.value}))} spellCheck={false}/>
          </label>)}
        </div>
        <small style={{color:'var(--faint)',fontSize:10}}>下方为参数渲染后的最终部署内容（安装时镜像地址已按加速站设置改写）。点击安装后，拉取镜像与启动日志会实时显示。</small>
        <div className="install-banner running">最终部署预览（{mirror?`镜像经 ${mirror} 加速`:'镜像直连'}）</div>
        <pre className="store-compose">{rendered?.compose||'渲染中…'}</pre>
      </div></>
      :<><header><div><small>{detail.name} v{detail.version}</small><h2>{jobDone?'✓ 安装完成':job.status==='error'?'✗ 安装失败':'正在安装…'}</h2></div>
        <div className="fm-tools">
          {jobDone&&<button className="fm-btn" onClick={()=>{setDetail(null);setJob(null);onNavigate('containers');}}>前往容器页</button>}
          {jobDone&&<button className="fm-btn" onClick={()=>{setDetail(null);setJob(null);onNavigate('compose');}}>前往编排页</button>}
          {(jobDone||job.status==='error')&&<button className="fm-btn" onClick={()=>{setDetail(null);setJob(null);if(jobDone)load();}}>{jobDone?'关闭':'关闭（项目文件已保留，可在编排页重试启动）'}</button>}
        </div></header>
      <div className="store-modal-body">
        <div className={`install-banner ${job.status}`}>{job.status==='running'?'正在拉取镜像并启动容器，日志实时输出如下…':jobDone?'部署成功。容器列表与编排页中均可管理该应用。':'部署失败。下方为完整日志，常见原因：镜像源不可达、端口被占用。项目文件已保留。'}</div>
        <pre ref={logRef} className="store-compose install-log">{job.output||'正在启动安装进程…'}</pre>
      </div></>}
    </section></div>}

    {sourceEdit&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setSourceEdit(null)}><section className="file-modal" role="dialog" aria-modal="true" aria-label="商店设置" onMouseDown={(event)=>event.stopPropagation()}>
      <header><div><small>模板源（兼容 1Panel appstore 仓库格式）</small><h2>商店设置</h2></div><div className="fm-tools"><button className="fm-btn" onClick={()=>setSourceEdit(null)}>取消</button></div></header>
      <div className="store-modal-body">
        <div className="ai-form">
          <label>仓库地址<small> https://github.com/用户/仓库</small><input className="ai-input" value={sourceEdit.repo} onChange={(event)=>setSourceEdit((current)=>current?{ ...current,repo:event.target.value }:current)} spellCheck={false}/></label>
          <label>分支<input className="ai-input" value={sourceEdit.branch} onChange={(event)=>setSourceEdit((current)=>current?{ ...current,branch:event.target.value }:current)} spellCheck={false}/></label>
          <label>镜像加速站<small> docker.io 镜像安装时改写为此地址，留空直连</small><input className="ai-input" value={sourceEdit.mirror} placeholder="docker.1ms.run" onChange={(event)=>setSourceEdit((current)=>current?{ ...current,mirror:event.target.value }:current)} spellCheck={false}/></label>
          <small style={{color:'var(--faint)',fontSize:10}}>仓库/分支变化会在保存后重新下载模板仓库（约 200MB）；加速站变化即时生效。默认源：1Panel-dev/appstore</small>
          <button className="fm-btn primary" disabled={Boolean(busy)} onClick={saveSource}>保存</button>
        </div>
      </div>
    </section></div>}
  </section>;
}
