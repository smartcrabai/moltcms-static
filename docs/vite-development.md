# Vite development

`@moltcms/static-vite` runs Vite middleware mode with the shared Rollup virtual-module plugin. Source edits use Vite HMR. Projection/content edits invalidate `virtual:moltcms/content` and issue an HTML full reload; browser assets never receive sync credentials.
