'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ImageItem = { id:string; repository:string; tag:string; size:string; createdSince:string };
type VolumeItem = { name:string; driver:string; links:string; size:string };
type JobState = { id:string; status:'running'|'done'|'error'; output:string; label:string };

export default function ImagesVolumes({ token, notify }:{ token:string;notify:(type:'ok'|'err',message:string)=>void }) {
  const [images,setImages] = useState<ImageItem[]|null>(null);
  const [volumes,setVolumes] = useState<VolumeItem[]|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [job,setJob] = useState<JobState|null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const jobLogRef = useRef<HTMLPreElement>(null);

  const locked = (key='') => !token || (Boolean(busy) && (busyKey === '' || busyKey === key));

  const load = useCallback(async () => {
    setBusy('读取镜像与卷');setBusyKey('');
    try {
      const [imageRes, volumeRes] = await Promise.all([
        fetch(`${__WPANEL_API__}/api/images`,{headers:{'X-WPanel-Token':token},cache:'no-store'}),
        fetch(`${__WPANEL_API__}/api/volumes`,{headers:{'X-WPanel-Token':token},cache:'no-store'}),
      ]);
      const imageData = await imageRes.json() as {images?:ImageItem[];error?:string};
      const volumeData = await volumeRes.json() as {volumes?:VolumeItem[];error?:string};
      if (!imageRes.ok) throw new Error(imageData.error || '镜像读取失败');
      if (!volumeRes.ok) throw new Error(volumeData.error || '卷读取失败');
      setImages(imageData.images || []);setVolumes(volumeData.volumes || []);setError('');
    } catch (reason) { setError(reason instanceof Error?reason.message:'读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  },[token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面拉取一次
    if (token) load();
  },[token,load]);

  // 拉取任务进度轮询
  useEffect(() => {
    if (!job || job.status !== 'running' || !token) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${__WPANEL_API__}/api/store/job/${job.id}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
        const data = await response.json() as {status?:JobState['status'];output?:string};
        if (!response.ok) { setJob((current) => current ? { ...current,status:'error',output:current.output+'\n任务查询失败' } : current); return; }
        setJob((current) => current && current.id === job.id ? { ...current, status:data.status || 'running', output:data.output || '' } : current);
        if (data.status === 'done') load();
      } catch { /* 单次轮询失败忽略 */ }
    }, 1000);
    return () => window.clearInterval(timer);
  },[job,token,load]);

  // 依赖 job.output 触发自动滚底（轮询 effect 单独管理任务刷新）
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在输出变化时滚动
  useEffect(() => { if (job && jobLogRef.current) jobLogRef.current.scrollTop = jobLogRef.current.scrollHeight; },[job?.output]);

  function pullImage() {
    const image = window.prompt('要拉取的镜像名（自动套用商店加速站设置）\n例如：nginx:alpine 或 b3log/siyuan:v3.8.1');
    if (!image || !image.trim()) return;
    setBusy('提交拉取任务');setBusyKey('pull');
    (async () => {
      try {
        const response = await fetch(`${__WPANEL_API__}/api/images/pull`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({image:image.trim()})});
        const result = await response.json() as {jobId?:string;target?:string;error?:string};
        if (!response.ok || !result.jobId) throw new Error(result.error || '任务提交失败');
        setJob({ id:result.jobId, status:'running', output:`docker pull ${result.target||image.trim()}\n`, label:image.trim() });
      } catch (reason) { notify('err',reason instanceof Error?reason.message:'提交失败'); }
      finally { setBusy('');setBusyKey(''); }
    })();
  }

  async function exportImage(image:ImageItem) {
    setBusy(`导出 ${image.repository}`);setBusyKey(image.id);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/images/export?id=${encodeURIComponent(image.id)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      if (!response.ok) { const failed = await response.json().catch(()=>({})) as {error?:string}; throw new Error(failed.error || '导出失败'); }
      const blob = await response.blob();
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);anchor.download = `${image.repository.replace(/[\/:]/g,'_')}_${image.tag}.tar`;anchor.click();
      URL.revokeObjectURL(anchor.href);
      notify('ok',`${image.repository}:${image.tag} 已开始下载`);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'导出失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function importImage(event:React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!window.confirm(`导入 ${file.name}（${(file.size/1048576).toFixed(1)} MB）？镜像较大时需要几分钟。`)) return;
    setBusy(`导入 ${file.name}`);setBusyKey('import');
    try {
      const response = await fetch(`${__WPANEL_API__}/api/images/import`,{method:'POST',headers:{'X-WPanel-Token':token},body:file});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '导入失败');
      notify('ok','镜像导入完成');await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'导入失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function mutate(label:string,url:string,body:Record<string,unknown>,key:string) {
    setBusy(label);setBusyKey(key);
    try {
      const response = await fetch(`${__WPANEL_API__}${url}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '操作失败');
      notify('ok',`${label}完成`);await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'操作失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  if (!token) return <section className="file-wrap"><div className="empty-state">控制会话尚未就绪，稍候自动重试。</div></section>;

  return <section className="file-wrap">
    <div className="section-title"><div><h2>镜像与卷</h2><p>镜像与卷的查看、删除与清理</p></div>{busy&&<span className="working">{busy}…</span>}</div>

    {error&&<div className="empty-state" style={{marginBottom:14}}>{error}</div>}

    {job&&<div className="file-card" style={{marginBottom:16,padding:'14px 16px'}}>
      <div className={`install-banner ${job.status}`} style={{marginBottom:10}}>{job.status==='running'?`正在拉取 ${job.label}（自动套用加速站），日志实时输出…`:job.status==='done'?`✓ ${job.label} 拉取完成`:`✗ ${job.label} 拉取失败`}</div>
      <pre ref={jobLogRef} className="store-compose install-log">{job.output||'…'}</pre>
      {job.status!=='running'&&<div style={{marginTop:10,display:'flex',gap:8}}><button className="mini-button ghost" onClick={()=>setJob(null)}>关闭</button></div>}
    </div>}

    <div className="section-title" style={{margin:'6px 0 10px'}}><div><h3 style={{margin:0,fontSize:15}}>镜像 <small style={{color:'var(--faint)',fontSize:11,fontWeight:400}}>{images?.length ?? '…'} 个</small></h3></div>
      <div className="section-tools">
        <button className="mini-button" disabled={locked('pull')} onClick={pullImage}>拉取镜像</button>
        <button className="mini-button ghost" disabled={locked('import')} onClick={()=>importRef.current?.click()}>导入镜像</button>
        <input ref={importRef} type="file" accept=".tar,.tar.gz,.tgz" hidden onChange={importImage} aria-hidden="true"/>
        <button className="mini-button ghost" disabled={locked('prune-dangling')} onClick={()=>{if(window.confirm('清理所有悬空镜像（无标签的中间层）？'))mutate('清理悬空镜像','/api/images/prune',{},'prune-dangling')}}>清理悬空</button>
        <button className="mini-button ghost" disabled={locked('prune-all')} onClick={()=>{if(window.confirm('清理所有未被容器使用的镜像？正在运行的容器不受影响，但相关镜像需要重新拉取。确认继续吗？'))mutate('清理未使用镜像','/api/images/prune',{all:true},'prune-all')}}>清理未使用</button>
        <button className="mini-button ghost" onClick={()=>load()}>刷新</button>
      </div></div>
    <div className="file-card"><table className="file-table container-table">
      <thead><tr><th>镜像</th><th>ID</th><th>大小</th><th>创建时间</th><th aria-label="操作"/></tr></thead>
      <tbody>
        {images?.map(image=><tr key={image.id+image.tag}>
          <td><span className="c-name-text"><strong className="mono-name">{image.repository}:{image.tag}</strong></span></td>
          <td><span className="container-id">{image.id}</span></td>
          <td className="f-size">{image.size}</td>
          <td className="f-size">{image.createdSince}</td>
          <td><span className="f-actions"><button className="mini-button ghost" disabled={locked(image.id)} onClick={()=>exportImage(image)} title="docker save 导出为 tar 下载">导出</button><button className="mini-button ghost" disabled={locked(image.id)} onClick={()=>{if(window.confirm(`删除镜像 ${image.repository}:${image.tag}？`))mutate('删除镜像','/api/images/delete',{id:image.id},image.id)}}>删除</button></span></td>
        </tr>)}
        {images?.length===0&&<tr><td colSpan={5} className="f-none">没有镜像</td></tr>}
      </tbody>
    </table></div>

    <div className="section-title" style={{margin:'26px 0 10px'}}><div><h3 style={{margin:0,fontSize:15}}>卷 <small style={{color:'var(--faint)',fontSize:11,fontWeight:400}}>{volumes?.length ?? '…'} 个</small></h3></div>
      <div className="section-tools">
        <button className="mini-button ghost" disabled={locked('vprune')} onClick={()=>{if(window.confirm('清理所有未被容器使用的卷？卷内数据将不可恢复。确认继续吗？'))mutate('清理未使用卷','/api/volumes/prune',{},'vprune')}}>清理未使用</button>
        <button className="mini-button ghost" onClick={()=>load()}>刷新</button>
      </div></div>
    <div className="file-card"><table className="file-table container-table">
      <thead><tr><th>卷</th><th>驱动</th><th>被引用</th><th>大小</th><th aria-label="操作"/></tr></thead>
      <tbody>
        {volumes?.map(volume=><tr key={volume.name}>
          <td><span className="c-name-text"><strong className="mono-name">{volume.name}</strong></span></td>
          <td className="f-size">{volume.driver}</td>
          <td className="f-size">{volume.links}</td>
          <td className="f-size">{volume.size}</td>
          <td><span className="f-actions"><button className="mini-button ghost" disabled={locked(volume.name)||volume.links!=='0'} title={volume.links!=='0'?'卷正被容器使用':'删除卷'} onClick={()=>{if(window.confirm(`删除卷 ${volume.name}？卷内数据将不可恢复。`))mutate('删除卷','/api/volumes/delete',{name:volume.name},volume.name)}}>删除</button></span></td>
        </tr>)}
        {volumes?.length===0&&<tr><td colSpan={5} className="f-none">没有卷</td></tr>}
      </tbody>
    </table></div>
  </section>;
}
