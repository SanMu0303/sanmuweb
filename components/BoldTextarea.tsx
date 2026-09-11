"use client";
import {useRef,type TextareaHTMLAttributes} from 'react';

export default function BoldTextarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>) {
 const ref=useRef<HTMLTextAreaElement>(null);
 function bold(){
  const el=ref.current;if(!el)return;
  const start=el.selectionStart,end=el.selectionEnd,value=el.value;
  let next:string,from:number,to:number;
  if(start>=2&&value.slice(start-2,start)==='**'&&value.slice(end,end+2)==='**'){
   next=value.slice(0,start-2)+value.slice(start,end)+value.slice(end+2);from=start-2;to=end-2;
  }else if(end-start>4&&value.slice(start,start+2)==='**'&&value.slice(end-2,end)==='**'){
   next=value.slice(0,start)+value.slice(start+2,end-2)+value.slice(end);from=start;to=end-4;
  }else{
   next=value.slice(0,start)+'**'+value.slice(start,end)+'**'+value.slice(end);from=start+2;to=end+2;
  }
  if(props.maxLength&&next.length>props.maxLength)return;
  // Notify React through the native input event, retaining the existing form contract.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,next);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  requestAnimationFrame(()=>{el.focus();el.setSelectionRange(from,to)});
 }
 return <div className="bold-editor"><div className="bold-toolbar"><button type="button" aria-label="粗体" title="选中文字后加粗（⌘ / Ctrl + B）；再次点击取消" onMouseDown={e=>e.preventDefault()} onClick={bold}><b>B</b> 粗体</button><span>选中文字加粗 · 保留换行</span></div><textarea {...props} ref={ref} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'){e.preventDefault();bold()}props.onKeyDown?.(e)}}/></div>;
}
