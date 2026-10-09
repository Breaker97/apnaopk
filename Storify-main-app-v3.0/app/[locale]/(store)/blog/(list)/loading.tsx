import { Skeleton } from "@/components/ui/skeleton";

// Route-level fallback shown instantly on navigation while the server resolves
// the blog index. Mirrors blog/page.tsx (header, category chips, featured post,
// post grid).
//
// Lives in the (list) route group on purpose: at the blog/ segment level this
// index skeleton also wrapped blog/[slug], so an article page painted the post
// grid before the article itself streamed in.
export default function BlogLoading() {
  return (
    <div
      className="container mx-auto max-w-[1310px] px-4 pb-8 pt-6 md:pb-16 md:pt-14"
      aria-busy="true"
    >
      <p className="sr-only" aria-live="polite">
        Loading blog...
      </p>

      <Skeleton className="mb-8 h-5 w-32" />

      <div className="space-y-4">
        <Skeleton className="h-10 w-72 max-w-full" />
        <div className="flex gap-2 overflow-hidden md:flex-wrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </div>

      {/* Featured post */}
      <div className="mt-8 grid items-center gap-3.5 md:mt-20 md:grid-cols-[1.3fr_1fr] md:gap-10 lg:gap-[60px]">
        <Skeleton className="aspect-[16/10] w-full rounded-xl md:aspect-[1.8/1]" />
        <div className="space-y-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>

      {/* Post grid */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:mt-20 lg:grid-cols-3 lg:gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="aspect-[1.6/1] w-full rounded-xl" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
