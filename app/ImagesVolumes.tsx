'use client';

import { useCallback, useEffect, useState } from 'react';

type ImageItem = { id:string; repository:string; tag:string; size:string; createdSince:string };
type VolumeItem = { name:string; driver:string; links:string; size:string };

export default function ImagesVolumes({ token, notify }:{ token:string;notify:(type:'ok'|'err',message:string)=>void }) {
  const [images,setImages] = useState<ImageItem[]|null>(null);
  const [volumes,setVolumes] = useState<VolumeItem[]|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');

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

    <div className="section-title" style={{margin:'6px 0 10px'}}><div><h3 style={{margin:0,fontSize:15}}>镜像 <small style={{color:'var(--faint)',fontSize:11,fontWeight:400}}>{images?.length ?? '…'} 个</small></h3></div>
      <div className="section-tools">
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
          <td><span className="f-actions"><button className="mini-button ghost" disabled={locked(image.id)} onClick={()=>{if(window.confirm(`删除镜像 ${image.repository}:${image.tag}？`))mutate('删除镜像','/api/images/delete',{id:image.id},image.id)}}>删除</button></span></td>
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
