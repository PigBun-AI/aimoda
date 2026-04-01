import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Sparkles, TrendingUp, Camera, Palette, BookOpen } from 'lucide-react'
import { fetchGalleries, type Gallery } from './gallery-api'

const CATEGORIES = [
  { value: '', label: '全部', icon: Sparkles },
  { value: 'trend', label: '趋势分析', icon: TrendingUp },
  { value: 'collection', label: '品牌系列', icon: BookOpen },
  { value: 'street_style', label: '街拍精选', icon: Camera },
  { value: 'editorial', label: '编辑精选', icon: Palette },
  { value: 'inspiration', label: '灵感板', icon: Sparkles },
]

const PAGE_SIZE = 12

export function InspirationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const category = searchParams.get('category') || ''
  const page = parseInt(searchParams.get('page') || '1', 10)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const loadGalleries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchGalleries({
        category: category || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setGalleries(data.galleries)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to load galleries:', err)
    } finally {
      setLoading(false)
    }
  }, [category, page])

  useEffect(() => {
    loadGalleries()
  }, [loadGalleries])

  const setCategory = (cat: string) => {
    const params = new URLSearchParams(searchParams)
    if (cat) params.set('category', cat)
    else params.delete('category')
    params.delete('page')
    setSearchParams(params)
  }

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams)
    if (p > 1) params.set('page', String(p))
    else params.delete('page')
    setSearchParams(params)
  }

  return (
    <section className="space-y-6 sm:space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="font-serif text-2xl sm:text-3xl font-medium text-foreground">
          灵感情报站
        </h1>
        <p className="text-sm text-muted-foreground">
          由 AI 自动采集与整理的时尚灵感图集
        </p>
      </header>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon
          const isActive = category === cat.value
          return (
            <Button
              key={cat.value}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory(cat.value)}
              className="gap-1.5"
            >
              <Icon className="h-3.5 w-3.5" />
              {cat.label}
            </Button>
          )
        })}
      </div>

      {/* Gallery Grid */}
      <div className="@container">
        <div className="grid gap-4 sm:gap-5 grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 stagger-children">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] w-full rounded-[var(--radius-md)]" />
              ))
            : galleries.map((gallery) => (
                <Link key={gallery.id} to={`/inspiration/${gallery.id}`} className="group">
                  <Card className="overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
                    {/* Cover Image */}
                    <div className="aspect-[3/4] relative overflow-hidden bg-muted">
                      {gallery.cover_url ? (
                        <img
                          src={gallery.cover_url}
                          alt={gallery.title}
                          className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10">
                          <Sparkles className="h-10 w-10 text-muted-foreground/30" />
                        </div>
                      )}
                      {/* Image count badge */}
                      <div className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
                        {gallery.image_count} 张
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3 sm:p-4 space-y-2">
                      <h3 className="font-medium text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                        {gallery.title}
                      </h3>
                      {gallery.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {gallery.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {gallery.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                        {gallery.tags.length > 3 && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">
                            +{gallery.tags.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
        </div>
      </div>

      {/* Empty state */}
      {!loading && galleries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">暂无灵感图集</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            AI Agent 正在努力采集中...
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </section>
  )
}
