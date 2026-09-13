"use client";
import {useRef,type ReactNode} from 'react';
export default function CourseDirectorySheet({children}:{children:ReactNode}){const dialog=useRef<HTMLDialogElement>(null);return <div className="mobile-course-directory"><button type="button" onClick={()=>dialog.current?.showModal()}>课程目录 ↗</button><dialog ref={dialog} aria-label="课程目录" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close()}}><button type="button" className="sheet-close" onClick={()=>dialog.current?.close()} aria-label="关闭课程目录">关闭 ×</button>{children}</dialog></div>}
