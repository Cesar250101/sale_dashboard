/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { loadJS } from "@web/core/assets";
import { Component, onWillStart, onMounted, onPatched, onWillUnmount, useRef, useState } from "@odoo/owl";

// Periodos de fecha disponibles en el filtro del encabezado
const PERIODS = [
    { value: "today", label: "Hoy" },
    { value: "yesterday", label: "Ayer" },
    { value: "this_week", label: "Esta semana" },
    { value: "this_month", label: "Este mes" },
    { value: "last_month", label: "Mes anterior" },
    { value: "same_month_last_year", label: "Mismo mes año anterior" },
    { value: "this_year", label: "Este año" },
    { value: "last_year", label: "Año anterior" },
    { value: "all", label: "Todo" },
];

// Paleta corporativa Method (tomada del logo)
const COLORS = {
    orange: "#F5841F",
    orangeLight: "#FBB040",
    slate: "#455160",
    slateLight: "#6B7787",
    slateDark: "#2F3845",
};

// Color por estado de la orden de venta
const STATE_COLORS = {
    draft: "#94A3B8",
    sent: COLORS.orangeLight,
    sale: "#16A34A",
    done: COLORS.slate,
    cancel: "#DC2626",
};

export class SaleDashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.periods = PERIODS;
        this.state = useState({ data: null, loading: true, period: "this_month" });
        this.stateChartRef = useRef("stateChart");
        this.trendChartRef = useRef("trendChart");
        this.categoryChartRef = useRef("categoryChart");
        this.customerChartRef = useRef("customerChart");
        this.salespersonChartRef = useRef("salespersonChart");
        this.paretoProductRef = useRef("paretoProductChart");
        this.paretoCustomerRef = useRef("paretoCustomerChart");
        this._charts = [];
        this._needRender = false;

        onWillStart(async () => {
            await loadJS("/web/static/lib/Chart/Chart.js");
            await this._loadData();
        });
        onMounted(() => this._renderCharts());
        onPatched(() => {
            if (this._needRender && !this.state.loading && (this.stateChartRef.el || this.categoryChartRef.el)) {
                this._needRender = false;
                this._renderCharts();
            }
        });
        onWillUnmount(() => this._destroyCharts());
    }

    async _loadData() {
        this.state.loading = true;
        this.state.data = await this.orm.call("sale.order", "get_dashboard_data", [
            this.state.period,
        ]);
        this.state.loading = false;
    }

    async reload() {
        this._needRender = true;
        await this._loadData();
    }

    onPeriodChange(ev) {
        this.state.period = ev.target.value;
        this.reload();
    }

    get kpis() {
        return (this.state.data && this.state.data.kpis) || {};
    }

    formatAmount(value) {
        const cur = (this.state.data && this.state.data.currency) || { symbol: "$", position: "before" };
        const num = (value || 0).toLocaleString("es-CL", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
        return cur.position === "after" ? `${num} ${cur.symbol}` : `${cur.symbol} ${num}`;
    }

    _destroyCharts() {
        this._charts.forEach((c) => c.destroy());
        this._charts = [];
    }

    _renderCharts() {
        if (!this.state.data || typeof Chart === "undefined") {
            return;
        }
        this._destroyCharts();
        const data = this.state.data;

        // --- Gráfico de dona: distribución por estado ---
        const byState = data.by_state.filter((s) => s.value > 0);
        if (this.stateChartRef.el && byState.length) {
            this._charts.push(
                new Chart(this.stateChartRef.el.getContext("2d"), {
                    type: "doughnut",
                    data: {
                        labels: byState.map((s) => s.label),
                        datasets: [
                            {
                                data: byState.map((s) => s.value),
                                backgroundColor: byState.map((s) => STATE_COLORS[s.key] || COLORS.slate),
                                borderWidth: 2,
                                borderColor: "#FFFFFF",
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: "62%",
                        plugins: {
                            legend: { position: "right", labels: { padding: 16, font: { size: 12 } } },
                        },
                    },
                })
            );
        }

        // --- Gráfico horizontal: ventas por categoría (Top 10) ---
        if (this.categoryChartRef.el && data.by_category && data.by_category.length) {
            const cats = [...data.by_category];
            const cur = data.currency || { symbol: "$" };
            const palette = [
                COLORS.orange, COLORS.orangeLight, COLORS.slate, COLORS.slateLight,
                "#16A34A", "#2563EB", "#9333EA", "#DC2626", "#0891B2", "#CA8A04",
            ];
            this._charts.push(
                new Chart(this.categoryChartRef.el.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: cats.map((c) => c.name),
                        datasets: [{
                            label: "Ventas",
                            data: cats.map((c) => c.amount),
                            backgroundColor: cats.map((_, i) => palette[i % palette.length]),
                            borderRadius: 5,
                            maxBarThickness: 28,
                        }],
                    },
                    options: {
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${cur.symbol} ${ctx.parsed.x.toLocaleString("es-CL")}`,
                                },
                            },
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                grid: { color: "#EEF2F6" },
                                ticks: { callback: (v) => `${cur.symbol} ${Number(v).toLocaleString("es-CL")}` },
                            },
                            y: { grid: { display: false } },
                        },
                    },
                })
            );
        }

        // --- Gráfico horizontal: ventas por cliente (Top 10) ---
        if (this.customerChartRef.el && data.by_customer && data.by_customer.length) {
            const custs = [...data.by_customer];
            const cur = data.currency || { symbol: "$" };
            this._charts.push(
                new Chart(this.customerChartRef.el.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: custs.map((c) => c.name),
                        datasets: [{
                            label: "Ventas",
                            data: custs.map((c) => c.amount),
                            backgroundColor: COLORS.slate,
                            hoverBackgroundColor: COLORS.orange,
                            borderRadius: 5,
                            maxBarThickness: 28,
                        }],
                    },
                    options: {
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${cur.symbol} ${ctx.parsed.x.toLocaleString("es-CL")}`,
                                },
                            },
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                grid: { color: "#EEF2F6" },
                                ticks: { callback: (v) => `${cur.symbol} ${Number(v).toLocaleString("es-CL")}` },
                            },
                            y: { grid: { display: false } },
                        },
                    },
                })
            );
        }

        // --- Gráfico horizontal: ventas por vendedor (Top 10) ---
        if (this.salespersonChartRef.el && data.by_salesperson && data.by_salesperson.length) {
            const sellers = [...data.by_salesperson];
            const cur = data.currency || { symbol: "$" };
            this._charts.push(
                new Chart(this.salespersonChartRef.el.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: sellers.map((s) => s.name),
                        datasets: [{
                            label: "Ventas",
                            data: sellers.map((s) => s.amount),
                            backgroundColor: COLORS.orangeLight,
                            hoverBackgroundColor: COLORS.orange,
                            borderRadius: 5,
                            maxBarThickness: 28,
                        }],
                    },
                    options: {
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${cur.symbol} ${ctx.parsed.x.toLocaleString("es-CL")}`,
                                },
                            },
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                grid: { color: "#EEF2F6" },
                                ticks: { callback: (v) => `${cur.symbol} ${Number(v).toLocaleString("es-CL")}` },
                            },
                            y: { grid: { display: false } },
                        },
                    },
                })
            );
        }

        // --- Gráfico de barras: ventas confirmadas por mes ---
        if (this.trendChartRef.el) {
            const cur = data.currency || { symbol: "$" };
            this._charts.push(
                new Chart(this.trendChartRef.el.getContext("2d"), {
                    type: "bar",
                    data: {
                        labels: data.trend.labels,
                        datasets: [
                            {
                                label: "Ventas confirmadas",
                                data: data.trend.values,
                                backgroundColor: COLORS.orange,
                                hoverBackgroundColor: COLORS.orangeLight,
                                borderRadius: 6,
                                maxBarThickness: 38,
                            },
                        ],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) =>
                                        `${cur.symbol} ${ctx.parsed.y.toLocaleString("es-CL")}`,
                                },
                            },
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: "#EEF2F6" },
                                ticks: {
                                    callback: (v) => `${cur.symbol} ${Number(v).toLocaleString("es-CL")}`,
                                },
                            },
                            x: { grid: { display: false } },
                        },
                    },
                })
            );
        }

        // --- Diagramas de Pareto: productos y clientes ---
        this._renderPareto(this.paretoProductRef.el, data.by_product, COLORS.orange);
        this._renderPareto(this.paretoCustomerRef.el, data.by_customer, COLORS.slate);
    }

    // Construye un diagrama de Pareto: barras (valor) + línea de % acumulado.
    // Asume que `items` ya viene ordenado de mayor a menor.
    _renderPareto(canvasEl, items, barColor) {
        if (!canvasEl || !items || !items.length) {
            return;
        }
        const data = this.state.data;
        const cur = data.currency || { symbol: "$" };

        const labels = items.map((it) => it.name);
        const values = items.map((it) => it.amount || 0);
        const total = values.reduce((a, b) => a + b, 0);
        let running = 0;
        const cumulative = values.map((v) => {
            running += v;
            return total ? (running / total) * 100 : 0;
        });

        // Chart.js v2.9.4 (versión incluida en Odoo 16): ejes con yAxes/xAxes.
        this._charts.push(
            new Chart(canvasEl.getContext("2d"), {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            type: "bar",
                            label: "Ventas",
                            data: values,
                            backgroundColor: barColor,
                            hoverBackgroundColor: COLORS.orangeLight,
                            maxBarThickness: 38,
                            order: 2,
                            yAxisID: "y-amount",
                        },
                        {
                            type: "line",
                            label: "% acumulado",
                            data: cumulative,
                            borderColor: "#16A34A",
                            backgroundColor: "rgba(22, 163, 74, 0.1)",
                            borderWidth: 2,
                            pointRadius: 3,
                            pointBackgroundColor: "#16A34A",
                            lineTension: 0.2,
                            fill: false,
                            order: 1,
                            yAxisID: "y-pct",
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    tooltips: {
                        mode: "index",
                        intersect: false,
                        callbacks: {
                            label: (item, chartData) => {
                                const ds = chartData.datasets[item.datasetIndex];
                                if (ds.yAxisID === "y-pct") {
                                    return `% acumulado: ${Number(item.value).toFixed(1)}%`;
                                }
                                return `${cur.symbol} ${Number(item.value).toLocaleString("es-CL")}`;
                            },
                        },
                    },
                    legend: { position: "top", labels: { padding: 14, fontSize: 12 } },
                    scales: {
                        yAxes: [
                            {
                                id: "y-amount",
                                position: "left",
                                ticks: {
                                    beginAtZero: true,
                                    callback: (v) => `${cur.symbol} ${Number(v).toLocaleString("es-CL")}`,
                                },
                                gridLines: { color: "#EEF2F6" },
                            },
                            {
                                id: "y-pct",
                                position: "right",
                                ticks: {
                                    beginAtZero: true,
                                    max: 100,
                                    callback: (v) => `${v}%`,
                                },
                                gridLines: { display: false },
                            },
                        ],
                        xAxes: [
                            {
                                gridLines: { display: false },
                                ticks: { autoSkip: false, maxRotation: 50, minRotation: 30 },
                            },
                        ],
                    },
                },
            })
        );
    }

    // Abre la lista de órdenes filtrada por estado (+ periodo) al hacer clic en una KPI
    openOrders(domain, title) {
        const dateDomain = (this.state.data && this.state.data.active_domain) || [];
        this.action.doAction({
            type: "ir.actions.act_window",
            name: title,
            res_model: "sale.order",
            views: [
                [false, "list"],
                [false, "form"],
            ],
            domain: [...dateDomain, ...(domain || [])],
            target: "current",
        });
    }
}

SaleDashboard.template = "sale_dashboard.Dashboard";

registry.category("actions").add("sale_dashboard", SaleDashboard);
