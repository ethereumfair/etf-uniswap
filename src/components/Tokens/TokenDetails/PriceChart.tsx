import { AxisBottom, TickFormatter } from '@visx/axis'
import { localPoint } from '@visx/event'
import { EventType } from '@visx/event/lib/types'
import { GlyphCircle } from '@visx/glyph'
import { Line } from '@visx/shape'
import { filterTimeAtom } from 'components/Tokens/state'
import { bisect, curveCardinal, NumberValue, scaleLinear, timeDay, timeHour, timeMinute, timeMonth } from 'd3'
import { TokenPrices$key } from 'graphql/data/__generated__/TokenPrices.graphql'
import { useTokenPricesCached } from 'graphql/data/Token'
import { PricePoint, TimePeriod } from 'graphql/data/Token'
import { useActiveLocale } from 'hooks/useActiveLocale'
import { useAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'react-feather'
import styled, { useTheme } from 'styled-components/macro'
import {
  dayHourFormatter,
  hourFormatter,
  monthDayFormatter,
  monthTickFormatter,
  monthYearDayFormatter,
  monthYearFormatter,
  weekFormatter,
} from 'utils/formatChartTimes'

import LineChart from '../../Charts/LineChart'
import { DISPLAYS, ORDERED_TIMES } from '../TokenTable/TimeSelector'

// TODO: This should be combined with the logic in TimeSelector.

export const DATA_EMPTY = { value: 0, timestamp: 0 }

export function getPriceBounds(pricePoints: PricePoint[]): [number, number] {
  const prices = pricePoints.map((x) => x.value)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return [min, max]
}

const StyledUpArrow = styled(ArrowUpRight)`
  color: ${({ theme }) => theme.accentSuccess};
`
const StyledDownArrow = styled(ArrowDownRight)`
  color: ${({ theme }) => theme.accentFailure};
`

export function calculateDelta(start: number, current: number) {
  return (current / start - 1) * 100
}

export function getDeltaArrow(delta: number) {
  if (Math.sign(delta) > 0) {
    return <StyledUpArrow size={16} key="arrow-up" />
  } else if (delta === 0) {
    return null
  } else {
    return <StyledDownArrow size={16} key="arrow-down" />
  }
}

export function formatDelta(delta: number) {
  let formattedDelta = delta.toFixed(2) + '%'
  if (Math.sign(delta) > 0) {
    formattedDelta = '+' + formattedDelta
  }
  return formattedDelta
}

export const ChartHeader = styled.div`
  position: absolute;
`
export const TokenPrice = styled.span`
  font-size: 36px;
  line-height: 44px;
`
export const DeltaContainer = styled.div`
  height: 16px;
  display: flex;
  align-items: center;
  margin-top: 4px;
`
const ArrowCell = styled.div`
  padding-left: 2px;
  display: flex;
`
export const TimeOptionsWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
`
export const TimeOptionsContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  gap: 4px;
  border: 1px solid ${({ theme }) => theme.backgroundOutline};
  border-radius: 16px;
  height: 40px;
  padding: 4px;
  width: fit-content;
`
const TimeButton = styled.button<{ active: boolean }>`
  background-color: ${({ theme, active }) => (active ? theme.backgroundInteractive : 'transparent')};
  font-weight: 600;
  font-size: 16px;
  padding: 6px 12px;
  border-radius: 12px;
  line-height: 20px;
  border: none;
  cursor: pointer;
  color: ${({ theme, active }) => (active ? theme.textPrimary : theme.textSecondary)};
  transition-duration: ${({ theme }) => theme.transition.duration.fast};
  :hover {
    ${({ active, theme }) => !active && `opacity: ${theme.opacity.hover};`}
  }
`

const margin = { top: 100, bottom: 48, crosshair: 72 }
const timeOptionsHeight = 44
const crosshairDateOverhang = 80

interface PriceChartProps {
  width: number
  height: number
  tokenAddress: string
  priceData?: TokenPrices$key | null
}

export function PriceChart({ width, height, tokenAddress, priceData }: PriceChartProps) {
  const [timePeriod, setTimePeriod] = useAtom(filterTimeAtom)
  const locale = useActiveLocale()
  const theme = useTheme()

  const { priceMap } = useTokenPricesCached(priceData, tokenAddress, 'ETHEREUM', timePeriod)
  const prices = priceMap.get(timePeriod)

  const startingPrice = prices?.[0] ?? DATA_EMPTY
  const endingPrice = prices?.[prices.length - 1] ?? DATA_EMPTY
  const [displayPrice, setDisplayPrice] = useState(startingPrice)
  const [crosshair, setCrosshair] = useState<number | null>(null)

  const graphWidth = width + crosshairDateOverhang
  const graphHeight = height - timeOptionsHeight > 0 ? height - timeOptionsHeight : 0
  const graphInnerHeight = graphHeight - margin.top - margin.bottom > 0 ? graphHeight - margin.top - margin.bottom : 0

  // Defining scales
  // x scale
  const timeScale = useMemo(
    () => scaleLinear().domain([startingPrice.timestamp, endingPrice.timestamp]).range([0, width]).nice(),
    [startingPrice, endingPrice, width]
  )
  // y scale
  const rdScale = useMemo(
    () =>
      scaleLinear()
        .domain(getPriceBounds(prices ?? []))
        .range([graphInnerHeight, 0]),
    [prices, graphInnerHeight]
  )

  function tickFormat(
    startTimestamp: number,
    endTimestamp: number,
    timePeriod: TimePeriod,
    locale: string
  ): [TickFormatter<NumberValue>, (v: number) => string, NumberValue[]] {
    const startDate = new Date(startingPrice.timestamp.valueOf() * 1000)
    const endDate = new Date(endingPrice.timestamp.valueOf() * 1000)
    switch (timePeriod) {
      case TimePeriod.HOUR:
        return [
          hourFormatter(locale),
          dayHourFormatter(locale),
          timeMinute.range(startDate, endDate, 10).map((x) => x.valueOf() / 1000),
        ]
      case TimePeriod.DAY:
        return [
          hourFormatter(locale),
          dayHourFormatter(locale),
          timeHour.range(startDate, endDate, 4).map((x) => x.valueOf() / 1000),
        ]
      case TimePeriod.WEEK:
        return [
          weekFormatter(locale),
          dayHourFormatter(locale),
          timeDay.range(startDate, endDate, 1).map((x) => x.valueOf() / 1000),
        ]
      case TimePeriod.MONTH:
        return [
          monthDayFormatter(locale),
          dayHourFormatter(locale),
          timeDay.range(startDate, endDate, 7).map((x) => x.valueOf() / 1000),
        ]
      case TimePeriod.YEAR:
        return [
          monthTickFormatter(locale),
          monthYearDayFormatter(locale),
          timeMonth.range(startDate, endDate, 2).map((x) => x.valueOf() / 1000),
        ]
      case TimePeriod.ALL:
        return [
          monthYearFormatter(locale),
          monthYearDayFormatter(locale),
          timeMonth.range(startDate, endDate, 6).map((x) => x.valueOf() / 1000),
        ]
    }
  }

  const handleHover = useCallback(
    (event: Element | EventType) => {
      if (!prices) return

      const { x } = localPoint(event) || { x: 0 }
      const x0 = timeScale.invert(x) // get timestamp from the scalexw
      const index = bisect(
        prices.map((x) => x.timestamp),
        x0,
        1
      )

      const d0 = prices[index - 1]
      const d1 = prices[index]
      let pricePoint = d0

      const hasPreviousData = d1 && d1.timestamp
      if (hasPreviousData) {
        pricePoint = x0.valueOf() - d0.timestamp.valueOf() > d1.timestamp.valueOf() - x0.valueOf() ? d1 : d0
      }

      setCrosshair(timeScale(pricePoint.timestamp))
      setDisplayPrice(pricePoint)
    },
    [timeScale, prices]
  )

  const resetDisplay = useCallback(() => {
    setCrosshair(null)
    setDisplayPrice(endingPrice)
  }, [setCrosshair, setDisplayPrice, endingPrice])

  // TODO: Display no data available error
  if (!prices) {
    return null
  }

  const [tickFormatter, crosshairDateFormatter, ticks] = tickFormat(
    startingPrice.timestamp,
    endingPrice.timestamp,
    timePeriod,
    locale
  )
  const delta = calculateDelta(startingPrice.value, displayPrice.value)
  const formattedDelta = formatDelta(delta)
  const arrow = getDeltaArrow(delta)
  const crosshairEdgeMax = width * 0.85
  const crosshairAtEdge = !!crosshair && crosshair > crosshairEdgeMax

  /* Default curve doesn't look good for the HOUR/ALL chart */
  const curveTension = timePeriod === TimePeriod.ALL ? 0.75 : timePeriod === TimePeriod.HOUR ? 1 : 0.9

  return (
    <>
      <ChartHeader>
        <TokenPrice>${displayPrice.value < 0.000001 ? '<0.000001' : displayPrice.value.toFixed(6)}</TokenPrice>
        <DeltaContainer>
          {formattedDelta}
          <ArrowCell>{arrow}</ArrowCell>
        </DeltaContainer>
      </ChartHeader>
      <LineChart
        data={prices}
        getX={(p: PricePoint) => timeScale(p.timestamp)}
        getY={(p: PricePoint) => rdScale(p.value)}
        marginTop={margin.top}
        curve={curveCardinal.tension(curveTension)}
        strokeWidth={2}
        width={graphWidth}
        height={graphHeight}
      >
        {crosshair !== null ? (
          <g>
            <AxisBottom
              scale={timeScale}
              stroke={theme.backgroundOutline}
              tickFormat={tickFormatter}
              tickStroke={theme.backgroundOutline}
              tickLength={4}
              tickTransform={'translate(0 -5)'}
              tickValues={ticks}
              top={graphHeight - 1}
              tickLabelProps={() => ({
                fill: theme.textSecondary,
                fontSize: 12,
                textAnchor: 'middle',
                transform: 'translate(0 -24)',
              })}
            />
            <text
              x={crosshair + (crosshairAtEdge ? -4 : 4)}
              y={margin.crosshair + 10}
              textAnchor={crosshairAtEdge ? 'end' : 'start'}
              fontSize={12}
              fill={theme.textSecondary}
            >
              {crosshairDateFormatter(displayPrice.timestamp)}
            </text>
            <Line
              from={{ x: crosshair, y: margin.crosshair }}
              to={{ x: crosshair, y: graphHeight }}
              stroke={theme.backgroundOutline}
              strokeWidth={1}
              pointerEvents="none"
              strokeDasharray="4,4"
            />
            <GlyphCircle
              left={crosshair}
              top={rdScale(displayPrice.value) + margin.top}
              size={50}
              fill={theme.accentActive}
              stroke={theme.backgroundOutline}
              strokeWidth={2}
            />
          </g>
        ) : (
          <AxisBottom scale={timeScale} stroke={theme.backgroundOutline} top={graphHeight - 1} hideTicks />
        )}
        <rect
          x={0}
          y={0}
          width={width}
          height={graphHeight}
          fill={'transparent'}
          onTouchStart={handleHover}
          onTouchMove={handleHover}
          onMouseMove={handleHover}
          onMouseLeave={resetDisplay}
        />
      </LineChart>
      <TimeOptionsWrapper>
        <TimeOptionsContainer>
          {ORDERED_TIMES.map((time) => (
            <TimeButton
              key={DISPLAYS[time]}
              active={timePeriod === time}
              onClick={() => {
                setTimePeriod(time)
              }}
            >
              {DISPLAYS[time]}
            </TimeButton>
          ))}
        </TimeOptionsContainer>
      </TimeOptionsWrapper>
    </>
  )
}

export default PriceChart
