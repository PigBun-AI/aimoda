import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  APP_SHELL_FULL_DESKTOP_MIN_WIDTH,
  APP_SHELL_PINNED_SIDEBAR_MIN_HEIGHT,
  APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH,
  shouldPinAppShellSidebar,
} from '@/components/layout/app-shell-layout'
import { PageFrame } from '@/components/layout/page-frame'
import { PageIntro } from '@/components/layout/page-intro'
import { SectionIntro } from '@/components/layout/section-intro'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

describe('compact UI baseline', () => {
  it('keeps MacBook-sized desktops in overlay sidebar mode', () => {
    expect(APP_SHELL_PINNED_SIDEBAR_MIN_WIDTH).toBe(1280)
    expect(APP_SHELL_PINNED_SIDEBAR_MIN_HEIGHT).toBe(860)
    expect(APP_SHELL_FULL_DESKTOP_MIN_WIDTH).toBe(1440)
    expect(shouldPinAppShellSidebar(1279, 900)).toBe(false)
    expect(shouldPinAppShellSidebar(1280, 800)).toBe(false)
    expect(shouldPinAppShellSidebar(1366, 768)).toBe(false)
    expect(shouldPinAppShellSidebar(1280, 860)).toBe(true)
    expect(shouldPinAppShellSidebar(1440, 760)).toBe(true)
  })

  it('defaults PageFrame to compact shell spacing', () => {
    const { container } = render(
      <PageFrame>
        <div>content</div>
      </PageFrame>,
    )

    expect(container.firstElementChild?.className).toContain('px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-8')
  })

  it('keeps PageIntro and SectionIntro in single-column mode until xl by default', () => {
    const { container } = render(
      <div>
        <PageIntro title="Reports" aside={<div>aside</div>} />
        <SectionIntro title="Admin" aside={<div>aside</div>} />
      </div>,
    )

    const headers = container.querySelectorAll('header')
    expect(headers[0]?.className).toContain('xl:grid-cols-[minmax(0,1.45fr)_minmax(14.5rem,0.72fr)]')
    expect(headers[0]?.className).not.toContain('lg:grid-cols')
    expect(headers[1]?.className).toContain('xl:grid-cols-[minmax(0,1.38fr)_minmax(14rem,0.8fr)]')
    expect(headers[1]?.className).not.toContain('lg:grid-cols')
  })

  it('uses compact default sizing for shared controls', () => {
    render(
      <div>
        <Button>Action</Button>
        <Input aria-label="Input" />
        <Select defaultValue="one">
          <SelectTrigger aria-label="Select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
          </SelectContent>
        </Select>
      </div>,
    )

    const button = screen.getByRole('button', { name: 'Action' })
    const input = screen.getByLabelText('Input')
    const selectTrigger = screen.getByRole('combobox', { name: 'Select' })

    expect(button.className).toContain('min-h-10 px-4 py-2.5')
    expect(input.className).toContain('min-h-10')
    expect(input.className).toContain('px-3.5 py-2.5')
    expect(selectTrigger.className).toContain('min-h-10')
    expect(selectTrigger.className).toContain('px-3 py-2.5')
  })

  it('uses tighter default dialog spacing', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dialog title</DialogTitle>
            <DialogDescription>Compact dialog</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const title = screen.getByText('Dialog title')
    const content = title.closest('[role="dialog"]')
    const header = title.parentElement

    expect(content?.className).toContain('gap-4')
    expect(content?.className).toContain('p-5')
    expect(header?.className).toContain('gap-2')
    expect(header?.className).toContain('pb-3')
  })
})
