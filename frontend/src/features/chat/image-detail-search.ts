import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { searchByColor, searchSimilar } from './chat-api'
import type { SearchByColorParams, SearchResponse, SearchSimilarParams } from './chat-api'

export type DetailSearchTarget =
  | { type: 'brand'; key: string }
  | { type: 'color'; key: string }
  | { type: 'label'; key: string }
  | null

type BrandQuery = {
  type: 'brand'
  brand: string
}

type ColorQuery = {
  type: 'color'
  hex: string
  colorName?: string
  gender?: string
}

type LabelQuery = {
  type: 'label'
  name: string
  category: string
  topCategory: string
  imageId: string
  gender?: string
}

type DetailSearchQuery = BrandQuery | ColorQuery | LabelQuery

type DetailSearchState = {
  query: DetailSearchQuery | null
  label: string
  results: SearchResponse | null
  isLoading: boolean
  activeTarget: DetailSearchTarget
}

const initialState: DetailSearchState = {
  query: null,
  label: '',
  results: null,
  isLoading: false,
  activeTarget: null,
}

function getViewportWidth() {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

function scrollResultsIntoView(target: HTMLElement | null) {
  if (!target || typeof window === 'undefined') return
  const rect = target.getBoundingClientRect()
  const stickyHeader = document.querySelector<HTMLElement>('[data-image-detail-header="true"]')
  const stickyHeaderOffset = stickyHeader ? stickyHeader.getBoundingClientRect().height + 24 : 88
  const top = Math.max(window.scrollY + rect.top - stickyHeaderOffset, 0)
  window.scrollTo({ top, behavior: 'smooth' })
}

export function getImageDetailGridColumns(viewportWidth: number) {
  if (viewportWidth >= 1536) return 5
  if (viewportWidth >= 1280) return 4
  if (viewportWidth >= 768) return 3
  return 2
}

export function getImageDetailSearchPageSize(viewportWidth: number) {
  return getImageDetailGridColumns(viewportWidth) * 3
}

function getTargetFromQuery(query: DetailSearchQuery): DetailSearchTarget {
  if (query.type === 'brand') {
    return { type: 'brand', key: query.brand.toLowerCase() }
  }
  if (query.type === 'label') {
    return { type: 'label', key: `${query.category}:${query.topCategory}:${query.name}`.toLowerCase() }
  }
  return { type: 'color', key: `${query.hex}:${query.colorName ?? ''}`.toLowerCase() }
}

async function executeDetailSearch(query: DetailSearchQuery, page: number, pageSize: number) {
  if (query.type === 'brand') {
    const params: SearchSimilarParams = {
      brand: query.brand,
      page,
      page_size: pageSize,
    }
    return searchSimilar(params)
  }

  if (query.type === 'label') {
    const params: SearchSimilarParams = {
      categories: [query.category],
      image_id: query.imageId,
      top_category: query.topCategory,
      gender: query.gender,
      page,
      page_size: pageSize,
    }
    return searchSimilar(params)
  }

  const params: SearchByColorParams = {
    hex: query.hex,
    color_name: query.colorName,
    gender: query.gender,
    page,
    page_size: pageSize,
  }
  return searchByColor(params)
}

export function useImageDetailSearch(scrollTargetRef: RefObject<HTMLElement>) {
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth)
  const [state, setState] = useState<DetailSearchState>(initialState)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const pageSize = useMemo(
    () => getImageDetailSearchPageSize(viewportWidth),
    [viewportWidth],
  )

  const runSearch = useCallback(async (
    query: DetailSearchQuery,
    label: string,
    page = 1,
  ) => {
    const currentRequestId = ++requestIdRef.current
    const activeTarget = getTargetFromQuery(query)

    setState(prev => ({
      ...prev,
      query,
      label,
      isLoading: true,
      activeTarget,
      results: page === 1 ? prev.results : prev.results,
    }))

    try {
      const results = await executeDetailSearch(query, page, pageSize)
      if (requestIdRef.current !== currentRequestId) return

      setState({
        query,
        label,
        results,
        isLoading: false,
        activeTarget: null,
      })

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scrollResultsIntoView(scrollTargetRef.current)
        })
      })
    } catch (error) {
      if (requestIdRef.current !== currentRequestId) return
      console.error('Detail search failed:', error)
      setState(prev => ({
        ...prev,
        query,
        label,
        isLoading: false,
        activeTarget: null,
      }))
    }
  }, [pageSize, scrollTargetRef])

  const searchByBrand = useCallback(async (brand: string, label: string) => {
    await runSearch({ type: 'brand', brand }, label, 1)
  }, [runSearch])

  const searchByPalette = useCallback(async (
    hex: string,
    colorName: string | undefined,
    gender: string | undefined,
    label: string,
  ) => {
    await runSearch({ type: 'color', hex, colorName, gender }, label, 1)
  }, [runSearch])

  const searchByLabel = useCallback(async (
    input: { name: string; category: string; topCategory: string; imageId: string; gender?: string },
  ) => {
    await runSearch({
      type: 'label',
      name: input.name,
      category: input.category,
      topCategory: input.topCategory,
      imageId: input.imageId,
      gender: input.gender,
    }, input.name, 1)
  }, [runSearch])

  const changePage = useCallback(async (page: number) => {
    if (!state.query) return
    await runSearch(state.query, state.label, page)
  }, [runSearch, state.label, state.query])

  const resetSearch = useCallback(() => {
    requestIdRef.current += 1
    setState(initialState)
  }, [])

  const lastPageSizeRef = useRef(pageSize)

  useEffect(() => {
    if (lastPageSizeRef.current === pageSize) return
    lastPageSizeRef.current = pageSize
    if (!state.query || !state.results) return
    void runSearch(state.query, state.label, state.results.page)
  }, [pageSize, runSearch, state.label, state.query, state.results])

  return {
    searchResults: state.results,
    searchLabel: state.label,
    isSearchLoading: state.isLoading,
    activeSearchTarget: state.activeTarget,
    searchByBrand,
    searchByPalette,
    searchByLabel,
    changePage,
    resetSearch,
  }
}
