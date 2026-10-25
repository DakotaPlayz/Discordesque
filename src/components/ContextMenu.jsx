import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight} from 'lucide-react';

// Keyboard and pointer accessible context menu with a look original to Mirlume.
// Items: {label,icon,checked,danger,disabled,onClick,submenu,divider,description}.
export default function ContextMenu({menu,onClose,items=[]}) {
  const [sub,setSub]=useState(-1);
  const ref=useRef(null);
  useEffect(()=>{
    if(!menu)return;
    const closeKey=e=>{if(e.key==='Escape')onClose();};
    const closeOutside=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};
    const closeScroll=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};
    window.addEventListener('keydown',closeKey);
    window.addEventListener('pointerdown',closeOutside);
    window.addEventListener('scroll',closeScroll,true);
    return()=>{
      window.removeEventListener('keydown',closeKey);
      window.removeEventListener('pointerdown',closeOutside);
      window.removeEventListener('scroll',closeScroll,true);
    };
  },[menu,onClose]);
  if(!menu)return null;
  const x=Math.max(8,Math.min(menu.x||0,window.innerWidth-300));
  const y=Math.max(8,Math.min(menu.y||0,window.innerHeight-410));
  const select=(item)=>{
    if(item.disabled)return;
    if(item.submenu){return;}
    onClose();item.onClick?.();
  };
  const renderList=(entries,child=false)=>entries.map((item,i)=>{
    if(item.divider)return <div key={'separator-'+i} className="mctx-divider" role="separator"/>;
    const Icon=item.icon;
    return <div className="mctx-wrapper" key={(item.label||'item')+'-'+i}>
      <button type="button" role={item.checked!==undefined?'menuitemcheckbox':'menuitem'}
        aria-checked={item.checked!==undefined?Boolean(item.checked):undefined}
        className={'mctx-item'+(item.danger?' danger':'')+(item.disabled?' unavailable':'')+(sub===i&&!child?' submenu-active':'')}
        disabled={item.disabled} title={item.disabled?item.description:undefined}
        onMouseEnter={()=>{if(!child)setSub(i);}}
        onClick={()=>item.submenu?(setSub(s=>s===i?-1:i)):select(item)}>
        {Icon&&<Icon size={17} strokeWidth={1.9} aria-hidden="true"/>}
        <span className="mctx-label"><span>{item.label}</span>{item.description&&!item.disabled&&<small>{item.description}</small>}</span>
        {item.checked!==undefined&&<span className={'mctx-check'+(item.checked?' checked':'')} aria-hidden="true">{item.checked?<Check size={12}/>:null}</span>}
        {item.submenu&&<ChevronRight size={16} aria-hidden="true"/>}
      </button>
      {!child&&item.submenu&&sub===i&&<div className="mctx-submenu" role="menu" aria-label={item.label}>{renderList(item.submenu,true)}</div>}
    </div>;
  });
  return createPortal(<div className="mctx-panel" style={{left:x,top:y}} role="menu" aria-label={menu.title||'Actions'} ref={ref}>
    {menu.title&&<div className="mctx-title">{menu.title}</div>}
    {renderList(items)}
  </div>,document.body);
}
