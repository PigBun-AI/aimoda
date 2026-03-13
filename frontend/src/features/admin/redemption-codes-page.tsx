import { useTranslation } from 'react-i18next'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import type { RedemptionCodeStatus, RedemptionCodeType } from '@/lib/types'
import { useRedemptionCodes, useGenerateCodes } from '@/features/admin/use-redemption-codes'

const typeLabels: Record<RedemptionCodeType, string> = {
  '1week': '1 week',
  '1month': '1 month',
  '3months': '3 months',
  '1year': '1 year',
}

export function RedemptionCodesPage() {
  const { t } = useTranslation('admin')
  const [type, setType] = useState<RedemptionCodeType>('1month')
  const [count, setCount] = useState('5')
  const codesQuery = useRedemptionCodes()
  const generateMutation = useGenerateCodes()

  const statusConfig: Record<RedemptionCodeStatus, { label: string; className: string }> = {
    unused: { label: t('unused'), className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
    used: { label: t('used'), className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
    expired: { label: t('expired'), className: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300' },
  }

  function handleGenerate() {
    const num = parseInt(count, 10)
    if (num > 0) {
      generateMutation.mutate({ type, count: num })
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          {t('redemptionCodes')}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('redemptionCodesDesc')}
        </p>
      </div>

      {/* Generate form */}
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('generateCodes')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={type} onValueChange={(v) => setType(v as RedemptionCodeType)}>
              <SelectTrigger
                className="w-full sm:w-40 h-10"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <SelectItem value="1week">1 week</SelectItem>
                <SelectItem value="1month">1 month</SelectItem>
                <SelectItem value="3months">3 months</SelectItem>
                <SelectItem value="1year">1 year</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full sm:w-24 h-10"
              placeholder={t('quantity')}
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
              }}
            />
            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="h-10"
              style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
            >
              {generateMutation.isPending ? t('generating') : t('generateCodes')}
            </Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-red-500 mt-2">{t('common:error')}</p>
          )}
        </CardContent>
      </Card>

      {/* Codes table */}
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardContent className="p-0">
          {codesQuery.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow style={{ borderColor: 'var(--border-color)' }}>
                  <TableHead style={{ color: 'var(--text-muted)' }}>{t('redemptionCodes')}</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>Type</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>Status</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>Created</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>Used By</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>Used At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codesQuery.data?.map((code) => {
                  const status = statusConfig[code.status]
                  return (
                    <TableRow key={code.id} style={{ borderColor: 'var(--border-color)' }}>
                      <TableCell>
                        <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                          {code.code}
                        </code>
                      </TableCell>
                      <TableCell style={{ color: 'var(--text-secondary)' }}>{typeLabels[code.type]}</TableCell>
                      <TableCell>
                        <Badge className={`${status.className} border-0 text-xs`}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(code.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {code.usedBy ?? '-'}
                      </TableCell>
                      <TableCell className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {code.usedAt ? new Date(code.usedAt).toLocaleDateString('zh-CN') : '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {codesQuery.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                      {t('noCodes')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
