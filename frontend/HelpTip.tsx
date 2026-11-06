import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {CircleHelp} from 'lucide-react';
import './help-tip.css';

export default function HelpTip({label,children,id}:{label:string;children:ReactNode;id?:string}) {
  const generatedId=useId(),tipId=id??generatedId;
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12});
  const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLSpanElement>(null);
  const closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const pinned=useRef(false);
  const close=useCallback(()=>{clearTimeout(closeTimer.current);pinned.current=false;setOpen(false);},[]);
  const show=()=>{clearTimeout(closeTimer.current);setOpen(true);};
  const leave=()=>{if(pinned.current)return;clearTimeout(closeTimer.current);closeTimer.current=setTimeout(close,120);};
  const toggle=()=>{clearTimeout(closeTimer.current);pinned.current=!pinned.current;setOpen(pinned.current);};

  const reposition=useCallback(()=>{
    if(!trigger.current||!popup.current)return;
    const anchor=trigger.current.getBoundingClientRect(),tip=popup.current.getBoundingClientRect();
    const left=Math.max(12,Math.min(anchor.left,window.innerWidth-tip.width-12));
    const top=anchor.bottom+8+tip.height<=window.innerHeight-12?anchor.bottom+8:Math.max(12,anchor.top-tip.height-8);
    setPosition(current=>current.left===left&&current.top===top?current:{left,top});
  },[]);
  useLayoutEffect(()=>{if(open)reposition();},[open,reposition]);

  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!trigger.current?.contains(event.target)&&!popup.current?.contains(event.target))close();};
    document.addEventListener('keydown',dismiss);
    document.addEventListener('pointerdown',outside);
    window.addEventListener('resize',reposition);
    window.addEventListener('scroll',reposition,true);
    return()=>{document.removeEventListener('keydown',dismiss);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};
  },[open,close,reposition]);
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);

  return <span className="help-tip" onMouseEnter={show} onMouseLeave={leave}>
    <button ref={trigger} className="help-tip-trigger" type="button" aria-label={'Ayuda: '+label} aria-describedby={tipId} onFocus={show} onBlur={close} onClick={toggle} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}><CircleHelp aria-hidden="true"/></button>
    {createPortal(<span ref={popup} id={tipId} className="help-tip-popup" role="tooltip" hidden={!open} style={position} onMouseEnter={show} onMouseLeave={leave}>{children}</span>,document.body)}
  </span>;
}
