"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AppImage } from "@/components/ui/app-image";
import { useEffect, useMemo, useState } from "react";
import { Search, X, GripVertical, FolderTree } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CategoryOption {
  _id: string;
  name: string;
  slug: string;
  image?: string;
  path?: string[];
}

interface CollectionCategorySelectorProps {
  selectedCategories: string[];
  onChange: (categoryIds: string[]) => void;
  title?: string;
}

export function CollectionCategorySelector({
  selectedCategories,
  onChange,
  title = "Categories in Section",
}: CollectionCategorySelectorProps) {
  const [searchValue, setSearchValue] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchCategories() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/categories?flat=true");
        const data = await res.json();
        if (cancelled) return;
        const list: CategoryOption[] = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
        setCategories(list);
      } catch (error) {
        console.error("Failed to fetch categories:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryById = useMemo(() => {
    const map = new Map<string, CategoryOption>();
    for (const category of categories) map.set(category._id, category);
    return map;
  }, [categories]);

  const searchResults = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((category) =>
      category.name.toLowerCase().includes(query),
    );
  }, [categories, searchValue]);

  const toggleCategory = (categoryId: string) => {
    if (selectedCategories.includes(categoryId)) {
      onChange(selectedCategories.filter((id) => id !== categoryId));
    } else {
      onChange([...selectedCategories, categoryId]);
    }
  };

  const removeCategory = (categoryId: string) => {
    onChange(selectedCategories.filter((id) => id !== categoryId));
  };

  const moveCategory = (fromIndex: number, toIndex: number) => {
    const newOrder = [...selectedCategories];
    const [removed] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, removed);
    onChange(newOrder);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search categories to add..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="border rounded-md">
          <div className="h-[200px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading categories...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No categories found
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {searchResults.map((category) => {
                  const isSelected = selectedCategories.includes(category._id);
                  const breadcrumb =
                    category.path && category.path.length > 1
                      ? category.path.slice(0, -1).join(" / ")
                      : null;
                  return (
                    <div
                      key={category._id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                      onClick={() => toggleCategory(category._id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        className="pointer-events-none"
                      />
                      <div className="relative h-10 w-10 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        {category.image ? (
                          <AppImage
                            src={category.image}
                            alt={category.name}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <FolderTree className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {category.name}
                        </div>
                        {breadcrumb && (
                          <div className="text-sm text-muted-foreground truncate">
                            {breadcrumb}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Selected Categories ({selectedCategories.length})
            </span>
            {selectedCategories.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
              >
                Clear all
              </Button>
            )}
          </div>

          {selectedCategories.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground border rounded-md">
              No categories selected. Search and add categories above.
            </div>
          ) : (
            <div className="border rounded-md divide-y">
              {selectedCategories.map((categoryId, index) => {
                const category = categoryById.get(categoryId);

                return (
                  <div
                    key={categoryId}
                    className="flex items-center gap-3 p-2 group"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
                    <div className="relative h-10 w-10 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                      {category?.image ? (
                        <AppImage
                          src={category.image}
                          alt={category.name}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <FolderTree className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {category ? (
                        <div className="font-medium truncate">
                          {category.name}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Unavailable category
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveCategory(index, index - 1)}
                          className="opacity-0 group-hover:opacity-100"
                        >
                          Up
                        </Button>
                      )}
                      {index < selectedCategories.length - 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveCategory(index, index + 1)}
                          className="opacity-0 group-hover:opacity-100"
                        >
                          Down
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeCategory(categoryId)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
