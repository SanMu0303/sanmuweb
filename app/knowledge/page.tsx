import Feed from '@/components/Feed';
import {listArticles,summaryOf} from '@/lib/repository';
export const metadata={title:'知识库 / 趋势课程'};
export default async function Knowledge(){return <><div className="page-heading"><div><div className="eyebrow">THE KNOWLEDGE LIBRARY</div><h1>知识库 / 趋势课程</h1><p>从趋势结构，到执行与复盘，逐步建立自己的交易框架。</p></div></div><div className="course-intro"><div><small>01 / 认识趋势</small><h3>建立共同语言</h3><p>趋势定义 · 阶段 · 观察方法</p></div><div><small>02 / 制定计划</small><h3>把判断变成条件</h3><p>三个买点 · 风险管理 · 退出</p></div><div><small>03 / 持续复盘</small><h3>让经验得以积累</h3><p>执行记录 · 心理 · 过程复盘</p></div></div><Feed articles={(await listArticles()).filter(a=>a.category==='趋势课程'||a.category==='交易计划').map(summaryOf)}/></>}
