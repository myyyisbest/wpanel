'use client';

import { useCallback, useEffect, useState } from 'react';

type StoreApp = { id:string; name:string; title:string; description:string; tags:string[]; type:string; website:string; github:string; document:string };
type FormField = { envKey:string; label:string; default:string|number; required:boolean; type:string; rule:string };

type Detail = StoreApp & { version:string; formFields:FormField[]; compose:string };

export default function StorePage({ token, notify }:{ token:string;notify:(type:'ok'|'err',message:string)=>void }) {
  const [apps,setApps] = useState<StoreApp[]|null>(null);
  const [source,setSource] = useState('');
  const [error,setError] = useState('');
  const [installed,setInstalled] = useState<string[]>([]);
  const [filter,setFilter] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [detail,setDetail] = useState<Detail|null>(null);
  const [params,setParams] = useState<Record<string,string>>({});
  const [showCompose,setShowCompose] = useState(false);

  const locked = (key='') => !token || (Boolean(busy) && (busyKey === '' || busyKey === key));

  const load = useCallback(async () => {
    setBusy('读取商店');setBusyKey('');
    try {
      const storeRes = await fetch(`${__WPANEL_API__}/api/store/apps`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const storeData = await storeRes.json() as {apps?:StoreApp[];source?:string;error?:string};
      if (!storeRes.ok) throw new Error(storeData.error || '商店读取失败');
      setApps(storeData.apps || []);setSource(storeData.source || '');setError('');
      // 已安装列表（失败不影响商店展示）
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

  async function openInstall(app:StoreApp) {
    setBusy(`读取 ${app.name}`);setBusyKey(app.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/app/${encodeURIComponent(app.id)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as Detail & {error?:string};
      if (!response.ok) throw new Error(result.error || '详情读取失败');
      const initial:Record<string,string> = {};
      for (const field of result.formFields) initial[field.envKey] = String(field.default ?? '');
      setParams(initial);setDetail(result);setShowCompose(false);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function install() {
    if (!detail) return;
    setBusy(`安装 ${detail.name}`);setBusyKey(detail.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/store/install`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({id:detail.id,params})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '安装失败');
      notify('ok',`${detail.name} 已部署，容器页/编排页可查看`);setDetail(null);await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'安装失败'); }
    finally { setBusy('');setBusyKey(''); }
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

  if (!token) return <section className="file-wrap"><div className="empty-state">控制会话尚未就绪，稍候自动重试。</div></section>;

  const list = (apps || []).filter((app) => !filter.trim() || `${app.name} ${app.title} ${app.tags.join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return <section className="file-wrap">
    <div className="section-title"><div><h2>应用商店</h2><p title={source}>{source ? `模板源：${source}` : '兼容 1Panel 应用商店格式'}</p></div>
      <div className="section-tools"><input aria-label="搜索应用" value={filter} onChange={(event)=>setFilter(event.target.value)} placeholder="搜索应用"/><button className="mini-button ghost" disabled={locked('refresh')} onClick={async()=>{setBusy('更新模板源');setBusyKey('refresh');try{const r=await fetch(`${__WPANEL_API__}/api/store/refresh`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:'{}'});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error||'更新失败');notify('ok','模板源已更新');await load();}catch(reason){notify('err',reason instanceof Error?reason.message:'更新失败')}finally{setBusy('');setBusyKey('')}}}>更新源</button><button className="mini-button ghost" onClick={()=>load()}>刷新</button></div></div>

    {busy&&<span className="working">{busy}…</span>}
    {error&&<div className="empty-state" style={{marginBottom:14}}>{error}{apps===null&&'——首次使用会克隆模板仓库，可能需要一两分钟'}</div>}

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

    {detail&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setDetail(null)}><section className="file-modal store-modal" role="dialog" aria-modal="true" aria-label={`安装 ${detail.name}`} onMouseDown={(event)=>event.stopPropagation()}>
      <header><div><small>{detail.name} v{detail.version} · 安装参数</small><h2>{detail.title}</h2></div>
        <div className="fm-tools"><button className="fm-btn" onClick={()=>setShowCompose(value=>!value)}>{showCompose?'隐藏':'预览'} compose</button><button className="fm-btn" onClick={()=>setDetail(null)}>取消</button><button className="fm-btn primary" disabled={Boolean(busy)} onClick={install}>确认安装</button></div></header>
      <div className="store-modal-body">
        <div className="store-form">
          {detail.formFields.length===0&&<small className="card-empty">该应用没有可配置参数，直接确认安装即可。</small>}
          {detail.formFields.map(field=><label className="store-field" key={field.envKey}>
            <span>{field.label}{field.required&&<i style={{color:'var(--bad)'}}>*</i>}<small> {field.envKey}</small></span>
            <input value={params[field.envKey] ?? ''} onChange={(event)=>setParams(current=>({...current,[field.envKey]:event.target.value}))} spellCheck={false}/>
          </label>)}
        </div>
        {showCompose&&<pre className="store-compose">{detail.compose}</pre>}
      </div>
    </section></div>}
  </section>;
}
