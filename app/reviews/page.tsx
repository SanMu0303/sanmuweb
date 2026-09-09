import Feed from '@/components/Feed';
import {listArticles,summaryOf} from '@/lib/repository';
export const metadata={title:'市场复盘'};
export default async function Reviews(){return <><div className="page-heading"><div><div className="eyebrow">REVIEW & REFLECT</div><h1>市场复盘</h1><p>把当时的判断与后来的变化放在一起。</p></div></div><Feed articles={(await listArticles()).filter(a=>a.category==='市场复盘').map(summaryOf)}/></>}
