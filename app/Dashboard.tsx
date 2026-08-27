'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import FileManager from './FileManager';
import ImagesVolumes from './ImagesVolumes';
import ComposePage from './ComposePage';
import StorePage from './StorePage';
import AiPage from './AiPage';

type ContainerInfo = { id:string; name:string; image:string; state:string; status:string; ports:string; project:string; running:boolean };
type DockerDfItem = { Type:string; Total:number; Size:string };
type ServiceState = { key:string; name:string; state:string };
type Status = {
  timestamp:string; host:string; distro:string;
  ubuntu:{ running:boolean; systemd:boolean; ip:string|null; memoryUsedMb:number|null; memoryTotalMb:number|null; cpuPercent:number|null; uptimeSec:number|null; diskUsedMb:number|null; diskTotalMb:number|null };
  services:{ list:ServiceState[] };
  docker:{ running:boolean; version:string|null; runningContainers:number; totalContainers:number; df:DockerDfItem[] };
  containers:ContainerInfo[];
};
type ActivityEntry = { at:string; action:string; target:string; success:boolean; message:string };
type ThemeMode = 'auto'|'light'|'dark';

const API = __WPANEL_API__;
const memoryText = (value:number|null) => value === null ? '—' : value >= 1024 ? `${(value/1024).toFixed(2)} GB` : `${Math.round(value)} MB`;
const uptimeText = (value:number|null) => value == null ? '—' : value >= 86400 ? `${Math.floor(value/86400)} 天 ${Math.floor(value%86400/3600)} 小时` : value >= 3600 ? `${Math.floor(value/3600)} 小时 ${Math.floor(value%3600/60)} 分` : `${Math.max(1,Math.floor(value/60))} 分钟`;
const dfName = (type:string) => ({ Images:'镜像', Containers:'容器', 'Local Volumes':'卷', Volumes:'卷', 'Build Cache':'构建缓存' }[type] || type);
function hostPorts(ports:string) {
  const found = new Set<string>();
  for (const match of ports.matchAll(/:(\d+)->/g)) found.add(match[1]);
  return [...found];
}
const activityIcon:{[action:string]:string} = { start:'▶', stop:'■', shutdown:'■', restart:'↻', error:'!', save:'✎', upload:'↑', download:'↓', mkdir:'+', touch:'+', rename:'→', delete:'×', prune:'✂', exec:'›', install:'⤓', refresh:'⟳' };
const themeName:{[mode in ThemeMode]:string} = { auto:'跟随系统', light:'浅色', dark:'深色' };

function Icon({ name, size=16 }:{ name:string; size?:number }) {
  const paths:Record<string,ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    box: <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>,
    activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>,
    layers: <><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></>,
    workflow: <><rect x="3" y="3" width="8" height="8" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="8" height="8" rx="2"/></>,
    store: <><path d="M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/><path d="M2 5h20l-1.5-2.5A2 2 0 0 0 18.8 2H5.2a2 2 0 0 0-1.7 1.5Z"/><path d="M9 21v-6h6v6"/></>,
    spark: <><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></>,
    folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>,
    terminal: <><path d="m4 17 6-5-6-5"/><path d="M12 19h8"/></>,
    db: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></>,
    ram: <><rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8V5M12 8V5M17 8V5M7 16v3M12 16v3M17 16v3"/></>,
    gauge: <><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></>,
    'theme-auto': <><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/></>,
    'theme-sun': <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></>,
    'theme-moon': <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>,
    refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink:0 }}>{paths[name]}</svg>;
}

function Spark({ values, tone }:{ values:(number|null)[]; tone:string }) {
  const ys = values.map((value) => value == null || !Number.isFinite(value) ? null : 30 - (Math.max(0, Math.min(100, value)) / 100) * 28);
  const path = ys.map((y, index) => y == null ? null : `${((index / Math.max(1, ys.length - 1)) * 120).toFixed(1)},${y.toFixed(1)}`).filter(Boolean) as string[];
  return <svg className={`spark ${tone}`} viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true">
    {path.length >= 2 && <>
      <polygon points={`0,32 ${path.join(' ')} 120,32`}/>
      <polyline points={path.join(' ')}/>
    </>}
  </svg>;
}

export default function Dashboard() {
  const [status,setStatus] = useState<Status|null>(null);
  const [activity,setActivity] = useState<ActivityEntry[]>([]);
  const [token,setToken] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState('');
  const [busyKey,setBusyKey] = useState('');
  const [query,setQuery] = useState('');
  const [logView,setLogView] = useState<{name:string;logs:string}|null>(null);
  const [logTail,setLogTail] = useState('250');
  const [logFollow,setLogFollow] = useState(false);
  const [execView,setExecView] = useState<{name:string;cmd:string;output:string}|null>(null);
  const [theme,setTheme] = useState<ThemeMode>('auto');
  const [view,setView] = useState<'overview'|'containers'|'images'|'compose'|'store'|'files'|'ai'|'activity'>('overview');
  const [containerView,setContainerView] = useState<'cards'|'list'>('cards');
  const [history,setHistory] = useState<{cpu:(number|null)[];mem:(number|null)[]}>({cpu:[],mem:[]});
  const logBodyRef = useRef<HTMLPreElement>(null);

  const locked = useCallback((key='') => Boolean(busy) && (busyKey === '' || busyKey === key), [busy, busyKey]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/status`,{cache:'no-store'});
      if (!response.ok) throw new Error();
      const next:Status = await response.json();
      const memPercent = next.ubuntu.memoryUsedMb != null && next.ubuntu.memoryTotalMb ? next.ubuntu.memoryUsedMb / next.ubuntu.memoryTotalMb * 100 : null;
      setHistory(previous => ({
        cpu: [...previous.cpu, next.ubuntu.cpuPercent].slice(-60),
        mem: [...previous.mem, memPercent].slice(-60),
      }));
      setStatus(next); setError('');
    } catch { setError('无法连接 Windows 控制服务，请运行“启动WPanel.bat”。'); }
  },[]);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/activity`,{cache:'no-store'});
      if (response.ok) setActivity(await response.json());
    } catch {}
  },[]);

  useEffect(() => {
    // 启动时同步 localStorage 里保存的主题偏好（外部系统读取）
    const stored = window.localStorage.getItem('wpanel-theme');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初次拉取属于外部系统订阅的启动读取
    if (stored === 'light' || stored === 'dark') setTheme(stored);
    const storedView = window.localStorage.getItem('wpanel-container-view');
     
    if (storedView === 'list' || storedView === 'cards') setContainerView(storedView);
  },[]);

  useEffect(() => {
    window.localStorage.setItem('wpanel-container-view', containerView);
  },[containerView]);

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    window.localStorage.setItem('wpanel-theme', theme);
    if (theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  },[theme]);

  useEffect(() => {
    let active=true;
    fetch(`${API}/api/session`,{cache:'no-store'}).then(r=>r.json()).then(data=>{if(active)setToken((data as {token?:string}).token||'')}).catch(()=>{if(active)setError('无法连接 Windows 控制服务，请运行“启动WPanel.bat”。')});
    // 初次进入页面立即拉取一次状态与历史；此后每 5 秒轮询（标签页隐藏时暂停）
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初次拉取属于外部系统订阅的启动读取
    refresh();
     
    loadActivity();
    const timer=window.setInterval(()=>{ if(document.visibilityState!=='hidden') refresh(); },5000);
    const onVisible=()=>{ if(document.visibilityState==='visible'){ refresh(); loadActivity(); } };
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)};
  },[refresh,loadActivity]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(()=>setNotice(''), 4000);
    return ()=>window.clearTimeout(timer);
  },[notice]);

  useEffect(() => {
    if (!logView) return;
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape'){ setLogFollow(false); setLogView(null); } };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[logView]);

  useEffect(() => {
    if (!execView) return;
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape') setExecView(null); };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[execView]);

  async function runExec(name:string,cmd:string) {
    if (!cmd.trim()) return;
    setBusy(`执行命令`);setBusyKey(name);
    try {
      const response=await fetch(`${API}/api/containers/${encodeURIComponent(name)}/exec`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({cmd})});
      const result=await response.json() as {output?:string;error?:string};
      if(!response.ok)throw new Error(result.error||'执行失败');
      setExecView(current=>({name,cmd,output:(current&&current.name===name?current.output+'\n':'')+`$ ${cmd}\n${result.output||'（无输出）'}\n`}));
    }
    catch(reason){ notify('err',reason instanceof Error?reason.message:'执行失败'); }
    finally{setBusy('');setBusyKey('')}
  }

  useEffect(() => { if (logView && logBodyRef.current) logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight; },[logView]);

  const logName = logView?.name ?? '';
  useEffect(() => {
    if (!logName || !logFollow || !token) return;
    const source = new EventSource(`${API}/api/containers/${encodeURIComponent(logName)}/follow?tail=${logTail}&token=${encodeURIComponent(token)}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {line?:string;done?:boolean;error?:string};
        if (payload.error) setError(payload.error);
        if (payload.done) { setLogFollow(false); return; }
        if (payload.line) setLogView((current) => current && current.name === logName ? { ...current, logs: (current.logs ? `${current.logs}\n${payload.line}` : payload.line ?? '').slice(-200000) } : current);
      } catch { /* 忽略无法解析的事件 */ }
    };
    source.onerror = () => setLogFollow(false);
    return () => source.close();
  },[logName,logFollow,logTail,token]);

  const request = useCallback(async (url:string,body:Record<string,string>={}) => {
    if(!token) throw new Error('控制会话尚未就绪');
    const response=await fetch(`${API}${url}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
    const result=await response.json() as {error?:string};
    if(!response.ok) throw new Error(result.error||'操作失败'); return result;
  },[token]);

  async function act(label:string,url:string,body:Record<string,string>={},key='') {
    setBusy(label);setBusyKey(key);setNotice('');setError('');
    try { await request(url,body);setNotice(`${label}已完成`);await new Promise(r=>window.setTimeout(r,800));await refresh();await loadActivity(); }
    catch(reason){setError(reason instanceof Error?reason.message:'操作失败')}
    finally{setBusy('');setBusyKey('')}
  }

  async function showLogs(name:string,tail=logTail){
    if(!token)return;setBusy(`读取 ${name} 日志`);setBusyKey(name);setLogFollow(false);
    try{
      const response=await fetch(`${API}/api/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,{headers:{'X-WPanel-Token':token}});
      const result=await response.json() as {name:string;logs:string;error?:string};
      if(!response.ok)throw new Error(result.error||'日志读取失败');
      setLogTail(tail);setLogView({name:result.name,logs:result.logs});
    }
    catch(reason){setError(reason instanceof Error?reason.message:'日志读取失败')}
    finally{setBusy('');setBusyKey('')}
  }

  async function copyLogs(){
    if(!logView)return;
    try{ await navigator.clipboard.writeText(logView.logs||''); setNotice('日志已复制到剪贴板'); }
    catch{ setError('复制失败，请在日志中手动选择文本'); }
  }

  function toggleService(key:string, name:string, active:boolean) {
    if (active && !window.confirm(`将停止 ${name} 服务，确认继续吗？`)) return;
    act(`${active?'停止':'启动'} ${name} 服务`,`/api/services/${encodeURIComponent(key)}/${active?'stop':'start'}`,{},key);
  }

  const visibleContainers=useMemo(()=>{
    const all=status?.containers||[];
    const search=query.trim().toLowerCase();return search?all.filter(item=>`${item.name} ${item.image}`.toLowerCase().includes(search)):all;
  },[status,query]);
  const ubuntuOn=Boolean(status?.ubuntu.running),dockerOn=Boolean(status?.docker.running);
  const notify=useCallback((type:'ok'|'err',message:string)=>{ if(type==='err')setError(message); else setNotice(message); },[]);
  const memPercent = status?.ubuntu.memoryUsedMb != null && status?.ubuntu.memoryTotalMb ? Math.min(100, status.ubuntu.memoryUsedMb/status.ubuntu.memoryTotalMb*100) : null;
  const diskPercent = status?.ubuntu.diskUsedMb != null && status?.ubuntu.diskTotalMb ? Math.min(100, status.ubuntu.diskUsedMb/status.ubuntu.diskTotalMb*100) : null;
  const uptime = status?.ubuntu.uptimeSec ?? null;
  const loading=!status;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><span>WPanel</span></div>
      <nav className="nav-list" aria-label="主导航">
        <button className={view==='overview'?'nav-item active':'nav-item'} onClick={()=>setView('overview')}><span><Icon name="overview"/></span>总览</button>
        <button className={view==='containers'?'nav-item active':'nav-item'} onClick={()=>setView('containers')}><span><Icon name="box"/></span>容器</button>
        <button className={view==='images'?'nav-item active':'nav-item'} onClick={()=>setView('images')}><span><Icon name="layers"/></span>镜像</button>
        <button className={view==='compose'?'nav-item active':'nav-item'} onClick={()=>setView('compose')}><span><Icon name="workflow"/></span>编排</button>
        <button className={view==='store'?'nav-item active':'nav-item'} onClick={()=>setView('store')}><span><Icon name="store"/></span>应用商店</button>
        <button className={view==='ai'?'nav-item active':'nav-item'} onClick={()=>setView('ai')}><span><Icon name="spark"/></span>AI 助手</button>
        <button className={view==='files'?'nav-item active':'nav-item'} onClick={()=>setView('files')}><span><Icon name="folder"/></span>文件管理</button>
        <button className={view==='activity'?'nav-item active':'nav-item'} onClick={()=>setView('activity')}><span><Icon name="activity"/></span>运行信息</button>
      </nav>
      <div className="sidebar-foot"><div className="host-mini"><span className={ubuntuOn?'pulse-dot':'offline-dot'}/><div><strong>{status?.host||'本机'}</strong><small>Ubuntu · WSL2</small></div></div><div className="security-note">仅限本机访问<br/>不开放远程终端</div></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">本机控制台</p><h1>WSL2 与 Docker 管理</h1></div><div className="top-actions"><span className="sync-state"><i className={error?'bad':''}/>{error?'连接异常':'每 5 秒刷新'}</span><button className="icon-button" aria-label="刷新" title="立即刷新" onClick={refresh}><Icon name="refresh"/></button><button className="icon-button" aria-label={`主题：${themeName[theme]}（点击切换）`} title={`主题：${themeName[theme]}（点击切换）`} onClick={()=>setTheme(mode=>mode==='auto'?'light':mode==='light'?'dark':'auto')}><Icon name={theme==='auto'?'theme-auto':theme==='light'?'theme-sun':'theme-moon'}/></button></div></header>
      <div className="content">
        {(error||notice)&&<div className={error?'toast error':'toast success'} role="status">{error||notice}<button onClick={()=>{setError('');setNotice('')}} aria-label="关闭">×</button></div>}

        <div className="view-fade" hidden={view!=='files'}><FileManager token={token} ubuntuOn={ubuntuOn} notify={notify}/></div>

        <div className="view-fade" hidden={view!=='images'}><ImagesVolumes token={token} notify={notify}/></div>

        <div className="view-fade" hidden={view!=='compose'}><ComposePage token={token} notify={notify} containers={status?.containers.map(item=>({name:item.name,project:item.project,running:item.running}))||[]}/></div>

        <div className="view-fade" hidden={view!=='store'}><StorePage token={token} notify={notify} onNavigate={(target)=>setView(target as typeof view)}/></div>

        <div className="view-fade" hidden={view!=='ai'}><AiPage token={token} notify={notify} containers={status?.containers.map(item=>({name:item.name,running:item.running}))||[]} onChanged={()=>{refresh();loadActivity();}}/></div>

        <div className="view-fade" hidden={view!=='overview'}>{loading?<section className="hero-status"><div className="hero-copy"><span className="status-pill"><i/>正在连接本机控制服务…</span><h2>正在读取系统状态</h2><p>WPanel 正在与 Windows 控制服务建立连接。</p></div></section>
        :<section className={`hero-status ${!ubuntuOn?'offline':''}`}><div className="hero-copy"><span className="status-pill"><i className={!ubuntuOn?'bad':''}/>{ubuntuOn?(dockerOn?'系统运行正常':'Docker 尚未启动'):'Ubuntu 当前已停止'}</span><h2>{ubuntuOn?(dockerOn?'Ubuntu 与 Docker 已就绪':'Ubuntu 已启动'):'随时启动你的本机环境'}</h2><p>控制接口仅监听 127.0.0.1，所有操作均为固定白名单命令。</p></div><div className="hero-actions">
          {ubuntuOn?<button className="button secondary" disabled={Boolean(busy)} onClick={()=>{if(window.confirm('将正常停止全部容器、Docker 和 PostgreSQL，然后关闭 Ubuntu。确认继续吗？'))act('安全关闭 WSL','/api/wsl/shutdown',{confirm:'SHUTDOWN'})}}>安全关闭 WSL</button>:<button className="button primary" disabled={Boolean(busy)} onClick={()=>act('启动 WSL','/api/wsl/start')}>启动 Ubuntu</button>}
          {ubuntuOn&&!dockerOn&&<button className="button primary" disabled={Boolean(busy)} onClick={()=>act('启动 Docker','/api/docker/start')}>启动 Docker</button>}
          {ubuntuOn&&dockerOn&&<button className="button primary" onClick={()=>setView('containers')}>管理容器</button>}
          {ubuntuOn&&dockerOn&&<button className="button secondary" disabled={Boolean(busy)} onClick={()=>{if(window.confirm('将停止 DPanel 与 Docker 服务（WSL 保持运行，已停止的容器状态不变）。确认继续吗？'))act('停止 Docker','/api/docker/stop',{confirm:'STOP_DOCKER'})}}>停止 Docker</button>}
        </div></section>}

        <section className="metric-grid" aria-label="运行状态">
          {loading?[0,1,2,3].map(index=><article className="metric-card" key={index}><div className="skeleton line w33"/><div className="skeleton line w60 tall"/><div className="skeleton line w80"/></article>)
          :<><article className="metric-card"><div className="metric-head"><span className="metric-icon violet"><Icon name="terminal" size={17}/></span><span className={`tag ${ubuntuOn?'online':'neutral'}`}>{ubuntuOn?'运行中':'已停止'}</span></div><p>Ubuntu WSL2</p><strong>{ubuntuOn?'已启动':'未运行'}</strong><small>{ubuntuOn?`systemd ${status?.ubuntu.systemd?'正常':'启动中'} · ${status?.ubuntu.ip||'读取中'}`:'点击上方按钮启动'}</small></article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon blue"><Icon name="box" size={17}/></span><span className={`tag ${dockerOn?'online':'neutral'}`}>{dockerOn?'运行中':'已停止'}</span></div><p>Docker Engine</p><strong>{dockerOn?status?.docker.version||'运行中':'未运行'}</strong><small>{dockerOn?`容器 ${status?.docker.runningContainers} / ${status?.docker.totalContainers} 正在运行`:'等待 Docker 启动'}</small></article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon amber"><Icon name="ram" size={17}/></span><span className="tag neutral">{memPercent==null?'—':`${Math.round(memPercent)}%`}</span></div><p>WSL 内存</p><strong>{memoryText(status?.ubuntu.memoryUsedMb??null)}</strong><div className="mem-bar" aria-hidden="true"><i style={{width:memPercent==null?0:`${memPercent}%`}}/></div><small>{ubuntuOn?`总计 ${memoryText(status?.ubuntu.memoryTotalMb??null)}`:'Ubuntu 未运行'}</small><Spark values={history.mem} tone="amber"/></article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon green"><Icon name="gauge" size={17}/></span><span className="tag neutral">实时</span></div><p>WSL CPU</p><strong>{status?.ubuntu.cpuPercent==null?'—':`${status.ubuntu.cpuPercent.toFixed(1)}%`}</strong><small>最近 5 分钟本机采样</small><Spark values={history.cpu} tone="green"/></article></>}
        </section>

        <section className="metric-grid detail-band" aria-label="系统详情">
          {loading?[0,1,2,3].map(index=><article className="metric-card" key={index}><div className="skeleton line w33"/><div className="skeleton line w60 tall"/><div className="skeleton line w80"/></article>)
          :<>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon violet"><Icon name="activity" size={17}/></span><span className="tag neutral">systemd</span></div><p>关键服务</p>
            {ubuntuOn&&(status?.services?.list?.length||0)>0?<div className="svc-list">
              {status!.services.list.map((service)=><div className="svc-row" key={service.key}><span>{service.name}</span><span className="svc-right"><span className={service.state==='active'?'state running':'state stopped'}><i/>{service.state==='active'?'运行中':service.state==='unknown'?'未知':'已停止'}</span>{service.key!=='docker'&&<button className="mini-button ghost svc-btn" disabled={locked(service.key)} onClick={()=>toggleService(service.key,service.name,service.state==='active')}>{service.state==='active'?'停止':'启动'}</button>}</span></div>)}
            </div>:<small className="card-empty">{ubuntuOn?'未配置监控服务（可用 data/wpanel.local.json 添加）':'Ubuntu 未运行'}</small>}
          </article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon amber"><Icon name="db" size={17}/></span><span className="tag neutral">{diskPercent==null?'—':`${Math.round(diskPercent)}%`}</span></div><p>WSL 磁盘</p>
            <strong>{memoryText(status?.ubuntu.diskUsedMb??null)}</strong>
            <div className="mem-bar" aria-hidden="true"><i style={{width:diskPercent==null?0:`${diskPercent}%`}}/></div>
            <small>根分区{status?.ubuntu.diskTotalMb!=null?` · 总计 ${memoryText(status.ubuntu.diskTotalMb)}`:''}{uptime!=null?` · 已运行 ${uptimeText(uptime)}`:''}</small>
          </article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon blue"><Icon name="box" size={17}/></span><span className="tag neutral">system df</span></div><p>Docker 占用</p>
            {dockerOn&&(status?.docker.df?.length||0)>0?<div className="svc-list">
              {status!.docker.df.map(item=><div className="df-row" key={item.Type}><span>{dfName(item.Type)}{item.Total>0&&<small>×{item.Total}</small>}</span><span className="f-size">{item.Size}</span></div>)}
            </div>:<small className="card-empty">{dockerOn?'读取中…':'Docker 未运行'}</small>}
          </article>
          <article className="metric-card"><div className="metric-head"><span className="metric-icon green"><Icon name="list" size={17}/></span><button className="text-button" onClick={()=>setView('activity')}>全部 →</button></div><p>最近操作</p>
            {activity.length>0?<div className="svc-list">
              {activity.slice(0,4).map((entry,index)=><div className="svc-row" key={`${entry.at}-${index}`}><span className="mini-act" title={`${entry.target} ${entry.message}`}>{activityIcon[entry.action]||'·'} {entry.target}</span><time>{new Date(entry.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div>)}
            </div>:<small className="card-empty">暂无操作记录</small>}
          </article></>}
        </section></div>

        <div className="view-fade" hidden={view!=='containers'}><section className="section-block"><div className="section-title"><div><h2>容器</h2><p>{dockerOn?`共 ${status?.docker.totalContainers||0} 个，其中 ${status?.docker.runningContainers||0} 个运行中`:'Docker 启动后显示容器'}</p></div><div className="section-tools"><div className="seg" role="group" aria-label="视图切换"><button className={containerView==='cards'?'active':''} onClick={()=>setContainerView('cards')}><Icon name="overview" size={13}/>卡片</button><button className={containerView==='list'?'active':''} onClick={()=>setContainerView('list')}><Icon name="list" size={13}/>列表</button></div><input aria-label="搜索容器" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索容器"/></div></div>
          {containerView==='cards'?<div className="container-grid">
            {loading?[0,1,2,3].map(index=><article className="container-card" key={index}><div className="skeleton line w33"/><div className="skeleton line w60 tall"/><div className="skeleton line w80"/><div className="skeleton line w50"/></article>)
            :visibleContainers.map(container=>{
              const ports=hostPorts(container.ports);
              return <article className="container-card" key={container.id}><div className="container-top"><span className="container-logo">{container.name.slice(0,1).toUpperCase()}</span><span className="container-id">{container.id.slice(0,8)}</span></div><div><span className="group-label">{container.project||'独立容器'}</span><h3>{container.name}</h3><p title={container.image}>{container.image}</p></div><div className="container-meta"><span className={container.running?'state running':'state stopped'}><i/>{container.running?'运行中':'已停止'}</span><span className="container-status" title={container.status}>{container.status||container.state}</span></div>{ports.length>0&&<div className="port-row">{ports.map(port=><a className="port-chip" key={port} href={`http://localhost:${port}`} target="_blank" rel="noreferrer" title={`在浏览器打开 localhost:${port}`}>:{port}</a>)}</div>}
              <div className="container-actions"><button disabled={locked(container.name)} className="mini-button" onClick={()=>act(`${container.running?'停止':'启动'} ${container.name}`,`/api/containers/${encodeURIComponent(container.name)}/${container.running?'stop':'start'}`)}>{container.running?'停止':'启动'}</button>{container.running&&<button disabled={locked(container.name)} className="mini-button ghost" onClick={()=>act(`重启 ${container.name}`,`/api/containers/${encodeURIComponent(container.name)}/restart`,{},container.name)}>重启</button>}<button disabled={locked(container.name)} className="mini-button ghost" onClick={()=>showLogs(container.name)}>日志</button>{container.running&&<button disabled={locked(container.name)} className="mini-button ghost" onClick={()=>setExecView({name:container.name,cmd:'',output:''})}>命令</button>}</div></article>;
            })}
            {dockerOn&&!loading&&visibleContainers.length===0&&<div className="empty-state">没有匹配的容器</div>}{!dockerOn&&!loading&&<div className="empty-state">Docker 当前未运行，启动后即可管理容器。</div>}
          </div>
          :<div className="file-card"><table className="file-table container-table">
            <thead><tr><th>容器</th><th>镜像</th><th>状态</th><th>端口</th><th aria-label="操作"/></tr></thead>
            <tbody>
              {loading&&[0,1,2,3].map(index=><tr key={index}><td colSpan={5}><div className="skeleton line" style={{margin:'6px 0'}}/></td></tr>)}
              {!loading&&visibleContainers.map(container=>{
                const ports=hostPorts(container.ports);
                return <tr key={container.id}>
                  <td><span className="c-name"><span className="container-logo sm">{container.name.slice(0,1).toUpperCase()}</span><span className="c-name-text"><strong>{container.name}</strong><small>{container.project||'独立容器'}</small></span></span></td>
                  <td className="c-image" title={container.image}>{container.image}</td>
                  <td><span className={container.running?'state running':'state stopped'}><i/>{container.running?'运行中':'已停止'}</span><span className="c-status">{container.status}</span></td>
                  <td>{ports.length>0?<span className="port-row">{ports.map(port=><a className="port-chip" key={port} href={`http://localhost:${port}`} target="_blank" rel="noreferrer" title={`打开 localhost:${port}`}>:{port}</a>)}</span>:<span className="f-size">—</span>}</td>
                  <td><span className="f-actions"><button disabled={locked(container.name)} className="mini-button" onClick={()=>act(`${container.running?'停止':'启动'} ${container.name}`,`/api/containers/${encodeURIComponent(container.name)}/${container.running?'stop':'start'}`)}>{container.running?'停止':'启动'}</button>{container.running&&<button disabled={locked(container.name)} className="mini-button ghost" onClick={()=>act(`重启 ${container.name}`,`/api/containers/${encodeURIComponent(container.name)}/restart`,{},container.name)}>重启</button>}<button disabled={locked(container.name)} className="mini-button ghost" onClick={()=>showLogs(container.name)}>日志</button></span></td>
                </tr>;})}
              {!loading&&dockerOn&&visibleContainers.length===0&&<tr><td colSpan={5} className="f-none">没有匹配的容器</td></tr>}
              {!loading&&!dockerOn&&<tr><td colSpan={5} className="f-none">Docker 当前未运行，到「总览」启动后即可管理容器。</td></tr>}
            </tbody>
          </table></div>}
        </section></div>

        <div className="view-fade" hidden={view!=='activity'}><section className="activity-panel"><div className="section-title"><div><h2>运行信息</h2><p>最近 50 条操作记录与控制边界</p></div>{busy&&<span className="working">{busy}…</span>}</div>
          {activity.length===0&&<div className="activity-empty">暂无操作记录，启动、停止或重启后这里会显示历史。</div>}
          {activity.map((entry,index)=><div className="activity-row" key={`${entry.at}-${index}`}><span className={`activity-icon ${entry.success?'success':'fail'}`}>{activityIcon[entry.action]||'·'}</span><div><strong>{entry.target}</strong><p>{entry.message}</p></div><time>{new Date(entry.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time></div>)}
          <div className="activity-row"><span className="activity-icon">⌾</span><div><strong>本机安全模式</strong><p>无删除、清理和任意命令接口；仅允许可信本机页面访问</p></div><time>已启用</time></div>
        </section></div>
      </div>
    </section>

    {execView&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setExecView(null)}><section className="log-modal" role="dialog" aria-modal="true" aria-label={`${execView.name} 命令执行`} onMouseDown={event=>event.stopPropagation()}>
      <header><div><small>容器内命令（实验性 · 每次单独执行）</small><h2>{execView.name}</h2></div>
        <div className="log-tools"><button onClick={()=>setExecView(null)} aria-label="关闭">×</button></div></header>
      <pre className="exec-out">{execView.output||'输入命令后回车执行，例如：ps aux'}</pre>
      <form className="exec-bar" onSubmit={(event)=>{event.preventDefault();runExec(execView.name,execView.cmd);setExecView({...execView,cmd:''});}}>
        <span>$</span><input autoFocus value={execView.cmd} onChange={(event)=>setExecView({...execView,cmd:event.target.value})} placeholder="sh 命令…" spellCheck={false} disabled={Boolean(busy)}/>
        <button type="submit" className="fm-btn primary" disabled={Boolean(busy)||!execView.cmd.trim()}>执行</button>
      </form>
    </section></div>}

    {logView&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>{setLogFollow(false);setLogView(null);}}><section className="log-modal" role="dialog" aria-modal="true" aria-label={`${logView.name} 日志`} onMouseDown={event=>event.stopPropagation()}>
      <header><div><small>容器日志 · 最近 {logTail} 行 · Esc 关闭</small><h2>{logView.name}</h2></div>
        <div className="log-tools">
          {['100','250','1000'].map(tail=><button key={tail} className={tail===logTail?'tail active':'tail'} onClick={()=>showLogs(logView.name,tail)}>{tail}</button>)}
          <button className={logFollow?'tail active':''} onClick={()=>setLogFollow(value=>!value)} title={logFollow?'暂停跟随':'跟随新输出'}>{logFollow?'⏸ 跟随中':'▶ 跟随'}</button>
          <button onClick={copyLogs} title="复制全部日志">复制</button>
          <button onClick={()=>showLogs(logView.name)} title="刷新日志" aria-label="刷新日志">↻</button>
          <button onClick={()=>{setLogFollow(false);setLogView(null);}} aria-label="关闭">×</button>
        </div></header>
      <pre ref={logBodyRef}>{logView.logs||'暂无日志输出'}</pre>
    </section></div>}
  </main>;
}
