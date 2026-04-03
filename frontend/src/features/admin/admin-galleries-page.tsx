import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useAdminGalleries, useDeleteGallery } from '@/features/admin/use-admin-galleries'
import { ExternalLink, Trash2, Image as ImageIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function AdminGalleriesPage() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const { data, isLoading } = useAdminGalleries()
  const deleteGalleryMutation = useDeleteGallery()

  function handleDelete(id: string) {
    if (window.confirm(t('common:deleteConfirm'))) {
      deleteGalleryMutation.mutate(id)
    }
  }

  const galleries = data?.galleries || []

  return (
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('common:galleriesTab')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('common:galleriesDesc')}
        </p>
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            {t('common:galleryList')}
          </h2>
        </div>
        <div className="space-y-4">
          {isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-lg" />
              ))
            : galleries.map((gallery) => (
                <div
                  key={gallery.id}
                  className="rounded-lg p-4 transition-colors hover:bg-accent bg-secondary"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* 封面图片 */}
                    <Link
                      to={`/galleries/${gallery.id}`}
                      className="sm:flex-shrink-0"
                    >
                      <div className="w-full h-48 sm:w-24 sm:h-24 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
                        {gallery.cover_url ? (
                          <img
                            src={gallery.cover_url}
                            alt={gallery.title}
                            className="w-full h-full object-cover hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                    </Link>

                    {/* 详情信息 */}
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/galleries/${gallery.id}`}
                        className="block font-medium hover:underline line-clamp-2 text-sm font-sans text-foreground"
                      >
                        {gallery.title}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground uppercase">
                          {gallery.category}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          /
                        </span>
                        <span className="text-xs text-muted-foreground inline-flex gap-1" title={gallery.tags?.join(', ')}>
                          {gallery.tags?.slice(0, 3).map(tag => (
                            <span key={tag} className="bg-background/80 px-1 py-0.5 rounded">{tag}</span>
                          ))}
                          {(gallery.tags?.length || 0) > 3 && '...'}
                        </span>
                      </div>
                      <div className="text-xs mt-2 text-muted-foreground font-sans flex items-center gap-2">
                        <span>{t('common:imageCountWithUnit', { count: gallery.image_count })}</span>
                        <span>•</span>
                        <span>
                          {new Date(gallery.created_at).toLocaleString(i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 sm:flex-col flex-shrink-0">
                      <Link to={`/galleries/${gallery.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 min-w-[70px]"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t('common:view')}
                        </Button>
                      </Link>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="gap-1 min-w-[70px]"
                        onClick={() => handleDelete(gallery.id)}
                        disabled={deleteGalleryMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t('common:delete')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
          {!isLoading && galleries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground font-sans">
              {t('common:noGalleries')}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
