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
import { REDEMPTION_CODE_TYPE_LABELS } from '@/lib/constants'
import { useRedemptionCodes, useGenerateCodes } from '@/features/admin/use-redemption-codes'

export function RedemptionCodesPage() {
  const { t } = useTranslation('admin')
  const [type, setType] = useState<RedemptionCodeType>('1month')
  const [count, setCount] = useState('5')
  const codesQuery = useRedemptionCodes()
  const generateMutation = useGenerateCodes()

  const statusConfig: Record<RedemptionCodeStatus, { label: string; variant: 'success' | 'default' | 'error' }> = {
    unused: { label: t('unused'), variant: 'success' },
    used: { label: t('used'), variant: 'default' },
    expired: { label: t('expired'), variant: 'error' },
  }

  function handleGenerate() {
    const num = parseInt(count, 10)
    if (num > 0) {
      generateMutation.mutate({ type, count: num })
    }
  }

  return (
    <section className="space-y-6 sm:space-y-8 font-sans">
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl font-medium mb-2 text-foreground">
          {t('redemptionCodes')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('redemptionCodesDesc')}
        </p>
      </div>

      {/* Generate form */}
      <Card className="border">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-foreground">{t('generateCodes')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={type} onValueChange={(v) => setType(v as RedemptionCodeType)}>
              <SelectTrigger className="w-full sm:w-40 h-10 sm:h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              className="w-full sm:w-24 h-10 sm:h-12"
              placeholder={t('quantity')}
            />
            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="h-10"
            >
              {generateMutation.isPending ? t('generating') : t('generateCodes')}
            </Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-destructive mt-2">{t('common:error')}</p>
          )}
        </CardContent>
      </Card>

      {/* Codes table */}
      <Card className="border bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {codesQuery.isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded" />
                ))}
              </div>
            ) : (
              <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground font-sans">{t('redemptionCodes')}</TableHead>
                  <TableHead className="text-muted-foreground font-sans">Type</TableHead>
                  <TableHead className="text-muted-foreground font-sans">Status</TableHead>
                  <TableHead className="text-muted-foreground font-sans">Created</TableHead>
                  <TableHead className="text-muted-foreground font-sans">Used By</TableHead>
                  <TableHead className="text-muted-foreground font-sans">Used At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codesQuery.data?.map((code) => {
                  const status = statusConfig[code.status]
                  return (
                    <TableRow key={code.id} className="border-border font-sans">
                      <TableCell>
                        <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground">
                          {code.code}
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-sans">{REDEMPTION_CODE_TYPE_LABELS[code.type]}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant} size="sm">{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-sans">
                        {new Date(code.createdAt).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-sans">
                        {code.usedBy ?? '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-sans">
                        {code.usedAt ? new Date(code.usedAt).toLocaleDateString('zh-CN') : '-'}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {codesQuery.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground font-sans">
                      {t('noCodes')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
