'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Project = { name:string; file:string };
type ContainerLite = { name:string; project:string; running:boolean };

export default function ComposePage({ token, notify, containers }:{ token:string;notify:(type:'ok'|'err',message:string)=>void;containers:ContainerLite[] }) {
  const [data,setData] = useState<{dir:string;projects:Project[]}|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [editor,setEditor] = useState<{path:string;content:string;dirty:boolean}|null>(null);
  const [logs,setLogs] = useState<{name:string;logs:string}|null>(null);
  const logBodyRef = useRef<HTMLPreElement>(null);

  const locked = (key='') => !token || (Boolean(busy) && (busyKey === '' || busyKey === key));

  const load = useCallback(async () => {
    setBusy('读取项目');setBusyKey('');
    try {
      const response = await fetch(`${__WPANEL_API__}/api/compose/projects`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as {dir?:string;projects?:Project[];error?:string};
      if (!response.ok) throw new Error(result.error || '读取失败');
      setData({ dir:result.dir || '', projects:result.projects || [] });setError('');
    } catch (reason) { setError(reason instanceof Error?reason.message:'读取失败');setData(null); }
    finally { setBusy('');setBusyKey(''); }
  },[token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入页面拉取一次
    if (token) load();
  },[token,load]);

  useEffect(() => { if (logs && logBodyRef.current) logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight; },[logs]);

  useEffect(() => {
    if (!editor && !logs) return;
    const onKey = (event:KeyboardEvent) => { if (event.key === 'Escape') { setLogs(null); setEditor((current) => { if (current?.dirty && !window.confirm('修改尚未保存，确认关闭？')) return current; return null; }); } };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[editor,logs]);

  async function openEditor(project:Project) {
    const path = `${data?.dir || ''}/${project.name}/${project.file}`;
    setBusy('打开文件');setBusyKey(project.name);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/files/read?path=${encodeURIComponent(path)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as {content?:string;error?:string};
      if (!response.ok) throw new Error(result.error || '读取失败');
      setEditor({ path, content:result.content ?? '', dirty:false });
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function saveEditor() {
    if (!editor || !editor.dirty) return;
    setBusy('保存');setBusyKey(editor.path);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/files/save`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({path:editor.path,content:editor.content})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '保存失败');
      setEditor({ ...editor,dirty:false });notify('ok','已保存，可用「启动」应用变更');
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'保存失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function act(label:string,project:string,url:string,body:Record<string,unknown>) {
    setBusy(label);setBusyKey(project);
    try {
      const response = await fetch(`${__WPANEL_API__}${url}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({project,...body})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '操作失败');
      notify('ok',`${label}完成`);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'操作失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function showLogs(project:string) {
    setBusy('读取日志');setBusyKey(project);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/compose/logs?project=${encodeURIComponent(project)}&tail=250`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as {name?:string;logs?:string;error?:string};
      if (!response.ok) throw new Error(result.error || '日志读取失败');
      setLogs({ name:project, logs:result.logs || '' });
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'日志读取失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function createProject() {
    const name = window.prompt('新项目名称（将创建在扫描目录下）');
    if (!name || !data) return;
    setBusy('新建项目');setBusyKey(name);
    try {
      const call = async (action:string,body:Record<string,unknown>) => {
        const response = await fetch(`${__WPANEL_API__}/api/files/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
        const result = await response.json() as {error?:string};
        if (!response.ok) throw new Error(result.error || '创建失败');
      };
      await call('mkdir',{path:`${data.dir}/${name}`});
      await call('touch',{path:`${data.dir}/${name}/compose.yaml`});
      notify('ok','项目已创建');await load();
      setEditor({ path:`${data.dir}/${name}/compose.yaml`, content:'services:\n  app:\n    image: nginx:alpine\n', dirty:true });
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'创建失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  async function removeProject(project:Project) {
    if (!window.confirm(`删除项目 ${project.name}？将停止其容器并删除整个项目文件夹（含 compose 文件）；数据卷默认保留。`)) return;
    setBusy('删除项目');setBusyKey(project.name);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/compose/delete`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({project:project.name})});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '删除失败');
      notify('ok',`项目 ${project.name} 已删除`);await load();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'删除失败'); }
    finally { setBusy('');setBusyKey(''); }
  }

  if (!token) return <section className="file-wrap"><div className="empty-state">控制会话尚未就绪，稍候自动重试。</div></section>;

  const stats = (name:string) => {
    const list = containers.filter((item) => item.project === name);
    return { total:list.length, running:list.filter((item) => item.running).length };
  };

  return <section className="file-wrap">
    <div className="section-title"><div><h2>Compose 编排</h2><p>{data?`扫描目录 ${data.dir}`:'自动发现 compose 项目'}</p></div><div className="section-tools"><button className="mini-button ghost" onClick={createProject} disabled={locked()}>新建项目</button><button className="mini-button ghost" onClick={()=>load()}>刷新</button></div></div>
    {busy&&<span className="working">{busy}…</span>}
    {error&&<div className="empty-state" style={{marginBottom:14}}>{error}</div>}
    {data&&<div className="file-card"><table className="file-table container-table">
      <thead><tr><th>项目</th><th>文件</th><th>容器</th><th aria-label="操作"/></tr></thead>
      <tbody>
        {data.projects.map(project=>{
          const stat = stats(project.name);
          return <tr key={project.name}>
            <td><span className="c-name-text"><strong>{project.name}</strong></span></td>
            <td className="f-size">{project.file}</td>
            <td className="f-size">{stat.total>0?<span className={stat.running>0?'state running':'state stopped'}><i/>{stat.running} / {stat.total} 运行中</span>:'未部署'}</td>
            <td><span className="f-actions">
              <button className="mini-button" disabled={locked(project.name)} onClick={()=>act(`启动 ${project.name}`,project.name,'/api/compose/up',{})}>启动</button>
              <button className="mini-button ghost" disabled={locked(project.name)} onClick={()=>{if(window.confirm(`停止并移除 ${project.name} 的容器？卷数据默认保留。`))act(`停止 ${project.name}`,project.name,'/api/compose/down',{})}}>停止</button>
              <button className="mini-button ghost" disabled={locked(project.name)} onClick={()=>openEditor(project)}>编辑</button>
              <button className="mini-button ghost" disabled={locked(project.name)} onClick={()=>showLogs(project.name)}>日志</button>
              <button className="mini-button ghost" disabled={locked(project.name)} onClick={()=>removeProject(project)}>删除</button>
            </span></td>
          </tr>;
        })}
        {data.projects.length===0&&<tr><td colSpan={4} className="f-none">扫描目录下没有 compose 项目——新建一个或把项目文件夹放进来</td></tr>}
      </tbody>
    </table></div>}

    {editor&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{if(!editor.dirty||window.confirm('修改尚未保存，确认关闭？'))setEditor(null);}}><section className="file-modal" role="dialog" aria-modal="true" onMouseDown={(event)=>event.stopPropagation()}>
      <header><div><small>{editor.dirty?'编辑中 · 未保存':'编辑 compose 文件'} · Esc 关闭</small><h2 title={editor.path}>{editor.path}</h2></div>
        <div className="fm-tools"><button className="fm-btn primary" disabled={!editor.dirty||Boolean(busy)} onClick={saveEditor}>保存</button><button className="fm-btn" onClick={()=>{if(!editor.dirty||window.confirm('修改尚未保存，确认关闭？'))setEditor(null);}}>关闭</button></div></header>
      <textarea className="edit-area" value={editor.content} spellCheck={false} onChange={(event)=>setEditor({ ...editor,content:event.target.value,dirty:true })}/>
    </section></div>}

    {logs&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setLogs(null)}><section className="log-modal" role="dialog" aria-modal="true" aria-label={`${logs.name} 日志`} onMouseDown={(event)=>event.stopPropagation()}>
      <header><div><small>Compose 日志 · 最近 250 行 · Esc 关闭</small><h2>{logs.name}</h2></div>
        <div className="log-tools"><button onClick={()=>showLogs(logs.name)} title="刷新日志">↻</button><button onClick={()=>setLogs(null)} aria-label="关闭">×</button></div></header>
      <pre ref={logBodyRef}>{logs.logs||'暂无日志输出'}</pre>
    </section></div>}
  </section>;
}
