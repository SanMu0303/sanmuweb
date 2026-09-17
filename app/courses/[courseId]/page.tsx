import courses from '@/content/courses.json';
import CourseDetail from '@/components/CourseDetail';
import type {Course} from '@/lib/videos';
export function generateStaticParams(){return (courses as Course[]).map(c=>({courseId:c.id}))}
export default async function Page({params}:{params:Promise<{courseId:string}>}){const {courseId}=await params;return <CourseDetail courseId={courseId}/>}
