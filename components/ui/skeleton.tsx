import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // A neutral grey, deliberately not a theme token: `bg-accent` takes
      // the storefront's brand hue, so on a blue theme every loading screen
      // pulsed blue and read as content rather than as absence.
      className={cn(
        "animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
