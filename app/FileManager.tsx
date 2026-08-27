'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { name:string;type:'dir'|'file'|'link';linkDir?:boolean;size:number|null;mtime:number|null };
type ListData = { path:string;roots:string[];entries:Entry[] };

const API = __WPANEL_API__;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const fmtBytes = (value:number|null) => value == null ? '—' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KB` : value < 1073741824 ? `${(value/1048576).toFixed(1)} MB` : `${(value/1073741824).toFixed(2)} GB`;
const fmtTime = (value:number|null) => value == null ? '—' : new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const rootLabel = (root:string) => root === '/var/lib/docker/volumes' ? 'docker 卷' : root.slice(1);
const joinPath = (dir:string,name:string) => dir === '/' ? `/${name}` : `${dir}/${name}`;
const iconFor = (entry:Entry) => entry.type === 'dir' ? '📁' : entry.type === 'link' ? '🔗' : IMG_EXT.test(entry.name) ? '🖼' : '📄';

export default function FileManager({ token, ubuntuOn, notify }:{ token:string;ubuntuOn:boolean;notify:(type:'ok'|'err',message:string)=>void }) {
  const [data,setData] = useState<ListData|null>(null);
  const [error,setError] = useState('');
  const [filter,setFilter] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [editor,setEditor] = useState<{path:string;content:string;dirty:boolean}|null>(null);
  const [image,setImage] = useState<{name:string;url:string}|null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const path = data?.path ?? null;

  const locked = (key='') => !token || (Boolean(busy) && (busyKey === '' || busyKey === key));

  const load = useCallback(async (target:string) => {
    setBusy('读取目录');setBusyKey(target);setError('');
    try {
      const response = await fetch(`${API}/api/files/list?path=${encodeURIComponent(target)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as ListData & {error?:string};
      if (!response.ok) throw new Error(result.error || '目录读取失败');
      setData(result);setFilter('');
    } catch (reason) { setError(reason instanceof Error?reason.message:'目录读取失败');setData(null); }
    finally { setBusy('');setBusyKey(''); }
  },[token]);

  useEffect(() => {
    // 进入面板时读取默认根目录；token 就绪即触发一次
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初次拉取属于外部系统订阅的启动读取
    if (token) load('/home');
  },[token,load]);

  const post = useCallback(async (action:string,body:Record<string,unknown>) => {
    const response = await fetch(`${API}/api/files/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
    const result = await response.json() as {error?:string};
    if (!response.ok) throw new Error(result.error || '操作失败');
  },[token]);

  async function openEntry(entry:Entry,full:string) {
    if (entry.type === 'dir' || entry.linkDir) return load(full);
    if (IMG_EXT.test(entry.name)) return preview(entry.name,full);
    return editFile(entry.name,full);
  }

  async function editFile(name:string,full:string) {
    setBusy(`打开 ${name}`);setBusyKey(full);setError('');
    try {
      const response = await fetch(`${API}/api/files/read?path=${encodeURIComponent(full)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as {content?:string;error?:string};
      if (!response.ok) throw new Error(result.error || '读取失败');
      setEditor({path:full,content:result.content ?? '',dirty:false});
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function preview(name:string,full:string) {
    setBusy(`预览 ${name}`);setBusyKey(full);
    try {
      const response = await fetch(`${API}/api/files/raw?path=${encodeURIComponent(full)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      if (!response.ok) { const failed = await response.json().catch(()=>({})) as {error?:string}; throw new Error(failed.error || '预览失败'); }
      const blob = await response.blob();
      setImage((previous) => { if (previous) URL.revokeObjectURL(previous.url); return { name, url:URL.createObjectURL(blob) }; });
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'预览失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function download(name:string,full:string) {
    setBusy(`下载 ${name}`);setBusyKey(full);
    try {
      const response = await fetch(`${API}/api/files/raw?path=${encodeURIComponent(full)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      if (!response.ok) { const failed = await response.json().catch(()=>({})) as {error?:string}; throw new Error(failed.error || '下载失败'); }
      const blob = await response.blob();
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);anchor.download = name;anchor.click();
      URL.revokeObjectURL(anchor.href);
      notify('ok',`${name} 已开始下载`);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'下载失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function saveEditor() {
    if (!editor || !editor.dirty) return;
    setBusy('保存文件');setBusyKey(editor.path);
    try {
      await post('save',{path:editor.path,content:editor.content});
      setEditor({ ...editor,dirty:false });notify('ok','文件已保存');if (path) load(path);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'保存失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  const closeEditor = useCallback(() => {
    setEditor((current) => {
      if (current?.dirty && !window.confirm('修改尚未保存，确认关闭？')) return current;
      return null;
    });
  },[]);

  function makeDirectory() {
    const name = window.prompt('新文件夹名称');
    if (!name) return;
    setBusy('新建文件夹');
    post('mkdir',{path:joinPath(path || '/',name)})
      .then(() => { notify('ok','目录已创建');if (path) load(path); })
      .catch((reason) => notify('err',reason instanceof Error?reason.message:'创建失败'))
      .finally(() => setBusy(''));
  }

  function makeFile() {
    const name = window.prompt('新文件名称');
    if (!name) return;
    setBusy('新建文件');
    post('touch',{path:joinPath(path || '/',name)})
      .then(() => { notify('ok','文件已创建');if (path) load(path); })
      .catch((reason) => notify('err',reason instanceof Error?reason.message:'创建失败'))
      .finally(() => setBusy(''));
  }

  function renameEntry(entry:Entry) {
    const name = window.prompt('重命名为',entry.name);
    if (!name || name === entry.name) return;
    setBusy('重命名');setBusyKey(entry.name);
    post('rename',{path:joinPath(path || '/',entry.name),name})
      .then(() => { notify('ok','已重命名');if (path) load(path); })
      .catch((reason) => notify('err',reason instanceof Error?reason.message:'重命名失败'))
      .finally(() => setBusy(''));setBusyKey('');
  }

  function removeEntries(entries:Entry[]) {
    const label = entries.length === 1 ? entries[0].name : `${entries.length} 项`;
    if (!window.confirm(`删除 ${label}？目录会连同内容一起删除，无法恢复。`)) return;
    setBusy('删除');setBusyKey(entries[0]?.name || '');
    post('delete',{paths:entries.map((entry) => joinPath(path || '/',entry.name))})
      .then(() => { notify('ok','已删除');if (path) load(path); })
      .catch((reason) => notify('err',reason instanceof Error?reason.message:'删除失败'))
      .finally(() => { setBusy('');setBusyKey(''); });
  }

  async function onUpload(event:React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || !path) return;
    for (const file of files) {
      const exists = data?.entries.some((entry) => entry.name === file.name);
      if (exists && !window.confirm(`${file.name} 已存在，覆盖吗？`)) continue;
      setBusy(`上传 ${file.name}`);setBusyKey(file.name);
      try {
        const response = await fetch(`${API}/api/files/upload?path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}${exists?'&overwrite=1':''}`,{method:'POST',headers:{'X-WPanel-Token':token},body:file});
        const result = await response.json() as {error?:string};
        if (!response.ok) throw new Error(result.error || '上传失败');
        notify('ok',`上传 ${file.name} 完成`);
      } catch (reason) { notify('err',reason instanceof Error?reason.message:'上传失败'); }
      finally { setBusy('');setBusyKey(''); }
    }
    await load(path);
  }

  useEffect(() => {
    if (!editor && !image) return;
    const onKey = (event:KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (image) setImage((previous) => { if (previous) URL.revokeObjectURL(previous.url); return null; });
      else if (editor) closeEditor();
    };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[editor,image,closeEditor]);

  const root = path ? (data?.roots || []).find((item) => path === item || path.startsWith(`${item}/`)) || '' : '';
  const crumbs = root ? [rootLabel(root),...path!.slice(root.length).split('/').filter(Boolean)] : [];
  const entries = (data?.entries || []).filter((entry) => !filter.trim() || entry.name.toLowerCase().includes(filter.trim().toLowerCase()));

  if (!token) return <section className="file-wrap"><div className="empty-state">控制会话尚未就绪，稍候自动重试。</div></section>;

  return <section className="file-wrap">
    <div className="section-title"><div><h2>文件管理</h2><p>通过 WSL 共享文件系统直接访问，无需在 Ubuntu 内安装任何组件</p></div>{busy&&<span className="working">{busy}…</span>}</div>
    {!ubuntuOn&&<div className="empty-state" style={{marginBottom:14}}>Ubuntu 未运行，文件面板暂不可用——先到「总览」启动。</div>}

    <div className="file-head">
      <nav className="crumbs" aria-label="路径">
        {crumbs.map((label,index)=>{
          const target = index===0 ? root : `${root}/${crumbs.slice(1,index).join('/')}/${label}`;
          return <span key={index} className="crumb-item">{index>0&&<i>›</i>}<button className={index===crumbs.length-1?'crumb last':'crumb'} onClick={()=>load(target)}>{label}</button></span>;
        })}
      </nav>
      <div className="file-tools">
        <input aria-label="过滤文件" value={filter} onChange={(event)=>setFilter(event.target.value)} placeholder="过滤当前目录"/>
        <button className="mini-button ghost" onClick={()=>path&&load(path)}>刷新</button>
        <button className="mini-button ghost" disabled={locked()} onClick={makeDirectory}>新建文件夹</button>
        <button className="mini-button ghost" disabled={locked()} onClick={makeFile}>新建文件</button>
        <button className="mini-button" disabled={locked()} onClick={()=>uploadRef.current?.click()}>上传</button>
        <input ref={uploadRef} type="file" multiple hidden onChange={onUpload} aria-hidden="true"/>
      </div>
    </div>

    {error&&<div className="empty-state">{error}</div>}
    {data&&!error&&<div className="file-card"><table className="file-table">
      <thead><tr><th>名称</th><th>大小</th><th>修改时间</th><th aria-label="操作"/></tr></thead>
      <tbody>
        {entries.map((entry)=>{
          const isDir = entry.type==='dir'||entry.linkDir;
          return <tr key={entry.name}>
            <td><span className="f-name"><span className="f-icon" aria-hidden="true">{iconFor(entry)}</span><button onClick={()=>openEntry(entry,joinPath(path||'/',entry.name))} title={entry.name}>{entry.name}</button></span></td>
            <td className="f-size">{isDir?'—':fmtBytes(entry.size)}</td>
            <td className="f-time">{fmtTime(entry.mtime)}</td>
            <td><span className="f-actions">
              {!isDir&&<button className="mini-button ghost" disabled={locked(entry.name)} onClick={()=>download(entry.name,joinPath(path||'/',entry.name))}>下载</button>}
              {!isDir&&entry.type==='file'&&<button className="mini-button ghost" disabled={locked(entry.name)} onClick={()=>editFile(entry.name,joinPath(path||'/',entry.name))}>编辑</button>}
              <button className="mini-button ghost" disabled={locked(entry.name)} onClick={()=>renameEntry(entry)}>改名</button>
              <button className="mini-button ghost" disabled={locked(entry.name)} onClick={()=>removeEntries([entry])}>删除</button>
            </span></td>
          </tr>;
        })}
        {entries.length===0&&<tr><td colSpan={4} className="f-none">{filter?'没有匹配的文件':'此目录为空'}</td></tr>}
      </tbody>
    </table></div>}

    {editor&&<div className="modal-backdrop" role="presentation" onMouseDown={closeEditor}><section className="file-modal" role="dialog" aria-modal="true" aria-label={`编辑 ${editor.path}`} onMouseDown={(event)=>event.stopPropagation()}>
      <header><div><small>编辑文件 · {fmtBytes(new Blob([editor.content]).size)}{editor.dirty?' · 未保存':''} · Esc 关闭</small><h2 title={editor.path}>{editor.path}</h2></div>
        <div className="fm-tools"><button className="fm-btn primary" disabled={!editor.dirty||Boolean(busy)} onClick={saveEditor}>保存</button><button className="fm-btn" onClick={closeEditor}>关闭</button></div></header>
      <textarea className="edit-area" value={editor.content} spellCheck={false} onChange={(event)=>setEditor({ ...editor,content:event.target.value,dirty:true })}/>
    </section></div>}

    {image&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{URL.revokeObjectURL(image.url);setImage(null);}}><figure className="img-modal" role="dialog" aria-modal="true" aria-label={`预览 ${image.name}`} onMouseDown={(event)=>event.stopPropagation()}>
      <header><span title={image.name}>{image.name}</span><button onClick={()=>{URL.revokeObjectURL(image.url);setImage(null);}} aria-label="关闭">×</button></header>
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地 blob 预览，不适用 next/image */}
      <img src={image.url} alt={image.name}/>
    </figure></div>}
  </section>;
}
