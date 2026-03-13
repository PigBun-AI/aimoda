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
  '1week': '1 周',
  '1month': '1 月',
  '3months': '3 月',
  '1year': '1 年',
}

const statusConfig: Record<RedemptionCodeStatus, { label: string; className: string }> = {
  unused: { label: '未使用', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  used: { label: '已使用', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  expired: { label: '已过期', className: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300' },
}

export function RedemptionCodesPage() {
  const [type, setType] = useState<RedemptionCodeType>('1month')
  const [count, setCount] = useState('5')
  const codesQuery = useRedemptionCodes()
  const generateMutation = useGenerateCodes()

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
          兑换码管理
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          生成和管理订阅兑换码
        </p>
      </div>

      {/* Generate form */}
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>生成兑换码</CardTitle>
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
                <SelectItem value="1week">1 周</SelectItem>
                <SelectItem value="1month">1 月</SelectItem>
                <SelectItem value="3months">3 月</SelectItem>
                <SelectItem value="1year">1 年</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full sm:w-24 h-10"
              placeholder="数量"
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
              {generateMutation.isPending ? '生成中...' : '生成'}
            </Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-red-500 mt-2">生成失败，请重试。</p>
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
                  <TableHead style={{ color: 'var(--text-muted)' }}>兑换码</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>类型</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>状态</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>创建时间</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>使用者</TableHead>
                  <TableHead style={{ color: 'var(--text-muted)' }}>使用时间</TableHead>
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
                      暂无兑换码
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
