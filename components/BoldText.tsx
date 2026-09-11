/** A deliberately small, escaped text format: only explicit **bold** is rendered. */
export default function BoldText({text}:{text:string}) {
 return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')&&part.length>4?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</>;
}
