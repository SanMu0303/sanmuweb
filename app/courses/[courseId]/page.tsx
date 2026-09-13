import courses from '@/content/courses.json';
import CourseDetail from '@/components/CourseDetail';
export function generateStaticParams(){return courses.map(c=>({courseId:c.id}))}
export default async function Page({params}:{params:Promise<{courseId:string}>}){const {courseId}=await params;return <CourseDetail courseId={courseId}/>}
