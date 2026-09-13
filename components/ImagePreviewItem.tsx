"use client";
import type {UploadItem} from '@/lib/useImageUploads';
export default function ImagePreviewItem({item,index,total,onRemove,onRetry,onStep}:{item:UploadItem;index:number;total:number;onRemove:()=>void;onRetry:()=>void;onStep:(direction:number)=>void}){
 return <div className="upload-preview-item" draggable={!item.deleting} onDragStart={e=>{e.dataTransfer.setData('application/x-research-image',item.id);e.dataTransfer.effectAllowed='move'}}>
  <img src={item.preview} alt={`待发布图片 ${index+1}`}/><span className="upload-number">{index+1}</span>
  <button type="button" className="upload-delete" disabled={item.deleting} aria-label={`删除图片 ${index+1}`} onClick={onRemove}>×</button>
  <div className="upload-order"><button type="button" disabled={index===0||item.deleting} aria-label={`图片 ${index+1} 前移`} onClick={()=>onStep(-1)}>←</button><button type="button" disabled={index===total-1||item.deleting} aria-label={`图片 ${index+1} 后移`} onClick={()=>onStep(1)}>→</button></div>
  {item.deleting?<span className="upload-state">正在删除…</span>:item.status==='error'?<button type="button" className="upload-state upload-error" onClick={onRetry} title={item.error}>上传失败，点击重试</button>:item.status!=='success'?<span className="upload-state" role="status">{item.status==='waiting'?'等待上传…':'图片上传中…'}</span>:null}
 </div>;
}
