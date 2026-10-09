import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // The skeleton colour: a neutral grey unless Branding sets one — never
      // the accent, which on a blue theme made every loading screen pulse
      // blue and read as content rather than as absence.
      className={cn("animate-pulse rounded-md bg-skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
