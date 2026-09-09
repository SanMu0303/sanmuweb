"use client";
import Feed from './Feed';
import ResourceState from './ResourceState';
import {useResource} from '@/lib/live';
import type {Article} from '@/lib/types';
export default function Collection({categories}:{categories:string[]}){const r=useResource<Omit<Article,'sections'>[]>('/api/articles');if(!r.data||r.error)return <ResourceState error={r.error} retry={r.retry}/>;return <Feed articles={r.data.filter(a=>categories.includes(a.category))}/>}
