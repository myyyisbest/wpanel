'use client';

import { useCallback, useEffect, useState } from 'react';

type ActivityEntry = { at:string; action:string; target:string; success:boolean; message:string };

export const activityIcon:{[action:string]:string} = { start:'▶', stop:'■', shutdown:'■', restart:'↻', error:'!', save:'✎', upload:'↑', download:'↓', mkdir:'+', touch:'+', rename:'→', delete:'×', prune:'✂', exec:'›', install:'⤓', refresh:'⟳', pull:'⤓' };
const PAGE_SIZE = 30;

export default function ActivityLog({ token, visible }:{ token:string;visible:boolean }) {
  const [data,setData] = useState<{total:number;items:ActivityEntry[]}|null>(null);
  const [page,setPage] = useState(1);
  const [searchInput,setSearchInput] = useState('');
  const [search,setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${__WPANEL_API__}/api/activity?page=${page}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(search)}`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
      const result = await response.json() as {total?:number;items?:ActivityEntry[]};
      if (response.ok) setData({ total:result.total || 0, items:result.items || [] });
    } catch { /* 保留旧数据 */ }
  },[token,page,search]);

  useEffect(() => {
    if (!token || !visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 页面可见时按需拉取外部数据
    load();
  },[token,visible,load]);

  // 搜索防抖
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => window.clearTimeout(timer);
  },[searchInput]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, totalPages);

  return <section className="activity-panel">
    <div className="section-title"><div><h2>日志记录</h2><p>操作审计日志{data?` · 共 ${data.total} 条`:''}</p></div>
      <div className="section-tools"><input aria-label="搜索日志" value={searchInput} onChange={(event)=>setSearchInput(event.target.value)} placeholder="搜索操作 / 目标 / 内容"/></div></div>

    {data&&data.items.length===0&&<div className="activity-empty">{search?'没有匹配的日志记录':'暂无操作记录，启动、停止或重启后这里会显示历史。'}</div>}
    {data?.items.map((entry,index)=><div className="activity-row" key={`${entry.at}-${index}`}>
      <span className={`activity-icon ${entry.success?'success':'fail'}`}>{activityIcon[entry.action]||'·'}</span>
      <div><strong>{entry.target}</strong><p>{entry.message}</p></div>
      <time>{new Date(entry.at).toLocaleTimeString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>
    </div>)}

    {data&&data.total>0&&<div className="pager">
      <button className="mini-button ghost" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>上一页</button>
      <span className="pager-info">第 {safePage} / {totalPages} 页 · 共 {data.total} 条</span>
      <button className="mini-button ghost" disabled={safePage>=totalPages} onClick={()=>setPage(safePage+1)}>下一页</button>
    </div>}
    <div className="activity-row"><span className="activity-icon">⌾</span><div><strong>本机安全模式</strong><p>无任意命令接口；所有操作均走白名单并记录到本文件</p></div><time>已启用</time></div>
  </section>;
}
