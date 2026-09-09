"use client";
import {useEffect,useState} from 'react';
export async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(path,{cache:'no-store',...init});const data=await response.json();if(!response.ok)throw new Error(data.error||'暂时无法读取，请稍后重试');return data;}
export function useResource<T>(path:string){const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [version,setVersion]=useState(0);useEffect(()=>{let active=true;setError('');request<T>(path).then(d=>{if(active)setData(d)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[path,version]);return {data,error,retry:()=>setVersion(v=>v+1)};}
