"use client";
import Feed from './Feed';
import ResourceState from './ResourceState';
import {useResource} from '@/lib/live';
import type {Post} from '@/lib/posts';
const mapped:Record<string,string>={'市场复盘':'市场复盘','趋势课程':'教学内容','交易计划':'交易计划','趋势观察':'观察更新'};
export default function Collection({categories}:{categories:string[]}){const r=useResource<Post[]>('/api/posts');if(!r.data||r.error)return <ResourceState error={r.error} retry={r.retry}/>;return <Feed articles={r.data.filter(p=>categories.map(c=>mapped[c]||c).includes(p.contentType))}/>}
