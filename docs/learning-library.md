# 视频优先的课程中心

一级入口为学习主题；内容形式（全部/视频/文章/案例）移到二级下拉框。
默认全部内容，视频先展示，文章与案例放在后面。搜索覆盖标题、系列名、标签、主题、说明及标的。

## 数据与课程结构

- `LibraryContent` 在 `lib/library.ts` 统一视频、文章和案例的基础字段，并保留原始记录关联。主题与搜索为派生展示，不改变既有帖子。
- `Video` 补充 topics、chapterId、lessonNumber；原 chapter 和 contentType 保持兼容。
- `Course` 补充 thumbnail、totalLessons、publishedLessons。
- `Chapter` 补充 courseId、order。
- `Lesson` 补充 chapterId、order、type，继续兼容 contentType。每章内部按 order 排序，视频 lessonNumber 按整个系列混合课时排序。
- 当前示例系列共 7 个课时：6 个视频、1 篇文字补充。统计不虚构尚不存在的课程。
- `LearningProgress` 预留 progress、lastWatchedAt、lastPosition、lessonId、courseId，当前全部为 null 占位；不记录或伪造观看进度。

完整目录使用 `/courses/trend-course/`，其他课程可由同一静态路由模板生成。
视频保持现有独立详情页和播放器，前后课时支持进入文字补充。

## 显示

课程中心专用 LibraryVideoCard，不修改首页使用的 VideoCard。
视频封面 16:9；普通桌面 3 列、1550px 以上 4 列、平板和手机 2 列、350px 以下 1 列。
右栏 250px（较窄桌面240px），sticky top24px；只显示当前系列第一章前4课。
1050px 以下隐藏右栏，用原生 dialog 目录弹层替代；主题导航横向滚动。
案例采用标的/市场/阶段/时间加摘要的记录形式，文章使用紧凑文字条目。

## 验证

本地浏览器：1440px 三列、1920px 四列，首排视频约430px处可见；课程入口实测约102px。
DOGE 搜索返回视频及案例；类型筛选可只显示案例；风险管理主题返回视频及文章。
完整目录2章7课，文字补充链接与视频上下课正常；390px手机双列、无横向溢出，目录弹层打开关闭正常。
列表页未创建 video 或 iframe 播放器。课程与搜索自动检查见 tests/library.test.mjs。

## 本次修改文件

- `app/courses/[courseId]/page.tsx`
- `components/CourseDetail.tsx`
- `components/CourseDirectorySheet.tsx`
- `components/CourseOutline.tsx`
- `components/KnowledgeLibrary.tsx`
- `components/LibraryVideoCard.tsx`
- `components/VideoDetail.tsx`
- `components/learning-library.css`
- `content/courses.json`
- `content/videos.json`
- `docs/learning-library.md`
- `lib/library.ts`
- `lib/videos.ts`
- `tests/library.test.mjs`
