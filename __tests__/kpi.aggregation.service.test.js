const { computeKpiRowsFromData, ALL_CITIES_KEY } = require('../src/services/kpiAggregationService');

describe('kpi aggregation service', () => {
  test('handles empty data sets safely', () => {
    const rows = computeKpiRowsFromData({
      dateKey: '2026-05-10',
      orders: [],
      dispatchJobs: [],
      cancellationReasons: [],
      refunds: [],
      payoutAgingHours: 0,
      disputeAgingHours: 0,
      disputesOpenCount: 0,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].city).toBe(ALL_CITIES_KEY);
    expect(rows[0].ordersCount).toBe(0);
    expect(rows[0].fillRate).toBe(0);
    expect(rows[0].stockoutRate).toBe(0);
    expect(rows[0].refundRatio).toBe(0);
    expect(rows[0].cancellationRate).toBe(0);
  });

  test('computes KPI metrics with partial data', () => {
    const rows = computeKpiRowsFromData({
      dateKey: '2026-05-10',
      orders: [
        {
          id: 'o-1',
          status: 'completed',
          totalAmount: 20,
          estimatedDeliveryTime: '2026-05-10T11:00:00.000Z',
          actualDeliveryTime: '2026-05-10T10:50:00.000Z',
          deliveryAddress: { city: 'Amman' },
        },
        {
          id: 'o-2',
          status: 'cancelled',
          totalAmount: 15,
          estimatedDeliveryTime: '2026-05-10T11:30:00.000Z',
          actualDeliveryTime: '2026-05-10T12:00:00.000Z',
          deliveryAddress: { city: 'Amman' },
        },
      ],
      dispatchJobs: [
        {
          city: 'Amman',
          createdAt: '2026-05-10T09:00:00.000Z',
          assignedAt: '2026-05-10T09:03:00.000Z',
        },
      ],
      cancellationReasons: [
        {
          orderId: 'o-2',
          reasonCode: 'out_of_stock',
        },
      ],
      refunds: [
        {
          orderId: 'o-2',
          amount: 5,
        },
      ],
      payoutAgingHours: 20,
      disputeAgingHours: 30,
      disputesOpenCount: 2,
    });

    const global = rows.find((row) => row.city === ALL_CITIES_KEY);
    const amman = rows.find((row) => row.city === 'Amman');

    expect(global).toBeTruthy();
    expect(amman).toBeTruthy();

    expect(global.ordersCount).toBe(2);
    expect(global.fillRate).toBe(0.5);
    expect(global.cancellationRate).toBe(0.5);
    expect(global.stockoutRate).toBe(0.5);
    expect(global.onTimeDeliveryRate).toBe(0.5);
    expect(global.assignmentLatencySec).toBe(180);
    expect(global.refundRatio).toBeCloseTo(5 / 35, 4);
    expect(global.payoutAgingHours).toBe(20);
    expect(global.disputeAgingHours).toBe(30);
    expect(global.disputesOpenCount).toBe(2);

    expect(amman.ordersCount).toBe(2);
    expect(amman.fillRate).toBe(0.5);
  });

  test('handles high-volume snapshots', () => {
    const orders = [];
    const dispatchJobs = [];
    const cancellationReasons = [];

    for (let i = 0; i < 5000; i += 1) {
      const city = i % 2 === 0 ? 'Amman' : 'Zarqa';
      const status = i % 10 === 0 ? 'cancelled' : 'completed';
      orders.push({
        id: `ord-${i}`,
        status,
        totalAmount: 10 + (i % 5),
        estimatedDeliveryTime: '2026-05-10T12:00:00.000Z',
        actualDeliveryTime: i % 4 === 0 ? '2026-05-10T11:55:00.000Z' : '2026-05-10T12:05:00.000Z',
        deliveryAddress: { city },
      });

      dispatchJobs.push({
        city,
        createdAt: '2026-05-10T08:00:00.000Z',
        assignedAt: '2026-05-10T08:02:30.000Z',
      });

      if (status === 'cancelled') {
        cancellationReasons.push({
          orderId: `ord-${i}`,
          reasonCode: 'stockout',
        });
      }
    }

    const rows = computeKpiRowsFromData({
      dateKey: '2026-05-10',
      orders,
      dispatchJobs,
      cancellationReasons,
      refunds: [],
      payoutAgingHours: 0,
      disputeAgingHours: 0,
      disputesOpenCount: 0,
    });

    const global = rows.find((row) => row.city === ALL_CITIES_KEY);
    expect(global).toBeTruthy();
    expect(global.ordersCount).toBe(5000);
    expect(global.fillRate).toBeCloseTo(0.9, 4);
    expect(global.cancellationRate).toBeCloseTo(0.1, 4);
    expect(global.stockoutRate).toBeCloseTo(0.1, 4);
  });
});
