"use client";
import ImagePreviewItem from './ImagePreviewItem';
import type {ImageUploads} from '@/lib/useImageUploads';
export default function ImagePreviewGrid({uploads}:{uploads:ImageUploads}){
 const {items}=uploads;if(!items.length)return null;
 return <div className="upload-preview-grid" style={{gridTemplateColumns:`repeat(${items.length===1?1:items.length<=4?2:3},minmax(0,1fr))`}} aria-label="待发布图片">
 {items.map((item,index)=><div key={item.id} onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-research-image')){e.preventDefault();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{const source=e.dataTransfer.getData('application/x-research-image');if(source){e.preventDefault();e.stopPropagation();uploads.move(source,item.id)}}}><ImagePreviewItem item={item} index={index} total={items.length} onRemove={()=>void uploads.remove(item.id)} onRetry={()=>uploads.retry(item.id)} onStep={direction=>uploads.move(item.id,items[index+direction].id)}/></div>)}
 </div>;
}
