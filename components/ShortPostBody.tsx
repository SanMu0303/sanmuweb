"use client";

import {useEffect, useId, useRef, useState} from 'react';
import type {PostBlock} from '@/lib/posts';
import BoldText from './BoldText';
import styles from './short-post-body.module.css';

export default function ShortPostBody({blocks}:{blocks:PostBlock[]}) {
  const contentId = useId();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const content = blocks.flatMap(block => [block.heading, block.text]).filter(text => typeof text === 'string' && text.trim()).join('\n\n');

  useEffect(() => {
    setExpanded(false);
  }, [content]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(body).lineHeight);
      setHasOverflow(body.scrollHeight > lineHeight * 4 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [content]);

  if (!content) return null;

  return <div className={`${styles.body} short-post-body`}>
    <p ref={bodyRef} id={contentId} className={`${styles.text} short-post-text ${expanded ? '' : styles.collapsed}`}>
      <BoldText text={content}/>
    </p>
    {hasOverflow && <button
      type="button"
      className={styles.toggle}
      aria-controls={contentId}
      aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}
    >{expanded ? '收起全文' : '展开全文'} <span aria-hidden="true">{expanded ? '↑' : '↓'}</span></button>}
  </div>;
}
