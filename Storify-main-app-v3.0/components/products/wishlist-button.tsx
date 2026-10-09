"use client";

import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlist } from "@/hooks/use-wishlist";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface WishlistButtonProps {
  productId: string;
  variant?: "icon" | "button";
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function WishlistButton({
  productId,
  variant = "icon",
  size = "md",
  className,
}: WishlistButtonProps) {
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const [isLoading, setIsLoading] = useState(false);

  const inWishlist = isInWishlist(productId);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsLoading(true);
    try {
      if (inWishlist) {
        const success = await removeFromWishlist(productId);
        if (success) {
          toast.success("Removed from wishlist");
        } else {
          toast.error("Please login to manage wishlist");
        }
      } else {
        const success = await addToWishlist(productId);
        if (success) {
          toast.success("Added to wishlist");
        } else {
          toast.error("Please login to add to wishlist");
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-9 w-9",
    lg: "h-10 w-10",
  };

  const iconSizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-5 w-5",
  };

  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          sizeClasses[size],
          "rounded-full bg-background/80 hover:bg-background shadow-sm backdrop-blur border border-border/60",
          inWishlist && "text-red-500 hover:text-red-600",
          className
        )}
        onClick={handleClick}
        disabled={isLoading}
        aria-label={inWishlist ? "Remove from wishlist" : "Add to wishlist"}
      >
        <Heart className={cn(iconSizes[size], inWishlist && "fill-current")} />
      </Button>
    );
  }

  return (
    <Button
      variant={inWishlist ? "destructive" : "outline"}
      size={size === "lg" ? "lg" : "default"}
      className={cn("gap-2", className)}
      onClick={handleClick}
      disabled={isLoading}
    >
      <Heart className={cn(iconSizes[size], inWishlist && "fill-current")} />
      {inWishlist ? "Remove from Wishlist" : "Add to Wishlist"}
    </Button>
  );
}
