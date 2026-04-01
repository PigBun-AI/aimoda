import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchGalleries, deleteGallery } from '@/features/inspiration/gallery-api'

export const adminGalleriesQueryKey = ['admin-galleries'] as const

export function useAdminGalleries(page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: [...adminGalleriesQueryKey, page, limit],
    queryFn: () =>
      fetchGalleries({
        offset: (page - 1) * limit,
        limit,
        // No status filter because admins can see all, though currently default is "published"
        // Adjust if needed. We use the same fetchGalleries API.
      }),
  })
}

export function useDeleteGallery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteGallery(id),
    onSuccess: () => {
      // Invalidate both admin and public gallery queries
      queryClient.invalidateQueries({ queryKey: adminGalleriesQueryKey })
      queryClient.invalidateQueries({ queryKey: ['galleries'] })
    },
  })
}
