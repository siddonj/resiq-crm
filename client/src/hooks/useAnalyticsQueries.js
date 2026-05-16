import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { analyticsApi } from '../api/analyticsApi'

const QK = {
  winLoss: ['analytics', 'win-loss'],
  velocity: ['analytics', 'velocity'],
  mrr: ['analytics', 'mrr'],
  serviceLines: ['analytics', 'service-lines'],
  forecast: ['analytics', 'forecast'],
  stageProbabilities: ['analytics', 'stage-probabilities'],
}

/**
 * Win/loss analytics.
 * @param {string} token
 */
export function useWinLossAnalytics(token) {
  return useQuery({
    queryKey: QK.winLoss,
    queryFn: () => analyticsApi.getWinLoss(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Deal velocity analytics.
 * @param {string} token
 */
export function useVelocityAnalytics(token) {
  return useQuery({
    queryKey: QK.velocity,
    queryFn: () => analyticsApi.getVelocity(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * MRR analytics.
 * @param {string} token
 */
export function useMrrAnalytics(token) {
  return useQuery({
    queryKey: QK.mrr,
    queryFn: () => analyticsApi.getMrr(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Service-line breakdown analytics.
 * @param {string} token
 */
export function useServiceLinesAnalytics(token) {
  return useQuery({
    queryKey: QK.serviceLines,
    queryFn: () => analyticsApi.getServiceLines(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Forecasting data.
 * @param {string} token
 */
export function useForecastAnalytics(token) {
  return useQuery({
    queryKey: QK.forecast,
    queryFn: () => analyticsApi.getForecast(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Stage probabilities.
 * @param {string} token
 */
export function useStageProbabilities(token) {
  return useQuery({
    queryKey: QK.stageProbabilities,
    queryFn: () => analyticsApi.getStageProbabilities(token).then((r) => r.data),
    enabled: !!token,
  })
}

/**
 * Update stage probabilities.
 */
export function useUpdateStageProbabilities(token) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (probabilities) =>
      analyticsApi.updateStageProbabilities(token, probabilities).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analytics'] })
    },
  })
}
