from datetime import datetime, time
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models


class SaleOrder(models.Model):
    _inherit = "sale.order"

    # Estados considerados como venta confirmada (para montos / tendencia)
    _DASHBOARD_CONFIRMED_STATES = ["sale", "done"]

    @api.model
    def _dashboard_period_range(self, period):
        """Devuelve (date_from, date_to) como objetos date para el periodo dado.

        date_to es exclusivo (límite superior). Si no hay rango, devuelve None.
        """
        today = fields.Date.context_today(self)
        if period == "today":
            return today, today + relativedelta(days=1)
        if period == "yesterday":
            return today - relativedelta(days=1), today
        if period == "this_week":
            start = today - relativedelta(days=today.weekday())
            return start, start + relativedelta(weeks=1)
        if period == "this_month":
            start = today.replace(day=1)
            return start, start + relativedelta(months=1)
        if period == "last_month":
            start = today.replace(day=1) - relativedelta(months=1)
            return start, start + relativedelta(months=1)
        if period == "same_month_last_year":
            start = today.replace(day=1) - relativedelta(years=1)
            return start, start + relativedelta(months=1)
        if period == "this_year":
            start = today.replace(month=1, day=1)
            return start, start + relativedelta(years=1)
        if period == "last_year":
            start = today.replace(month=1, day=1) - relativedelta(years=1)
            return start, start + relativedelta(years=1)
        # "all" u otro -> sin filtro
        return None

    @api.model
    def get_dashboard_data(self, period="this_month"):
        """Devuelve KPIs y series de datos para el tablero de ventas."""
        state_labels = dict(self._fields["state"].selection)

        # --- Dominio según el periodo seleccionado (sobre date_order) ----------
        rng = self._dashboard_period_range(period)
        domain = []
        active_domain = []
        if rng:
            date_from, date_to = rng
            start_dt = fields.Datetime.to_string(datetime.combine(date_from, time.min))
            end_dt = fields.Datetime.to_string(datetime.combine(date_to, time.min))
            domain = [("date_order", ">=", start_dt), ("date_order", "<", end_dt)]
            active_domain = list(domain)

        # --- Conteo por estado -------------------------------------------------
        grouped = self.read_group(domain, ["state"], ["state"])
        counts = {key: 0 for key in state_labels}
        for line in grouped:
            if line.get("state"):
                counts[line["state"]] = line["state_count"]

        total_orders = sum(counts.values())

        # --- Montos ------------------------------------------------------------
        amount_groups = self.read_group(domain, ["amount_total:sum"], [])
        total_amount = amount_groups[0]["amount_total"] if amount_groups else 0.0

        confirmed_domain = domain + [("state", "in", self._DASHBOARD_CONFIRMED_STATES)]
        confirmed_groups = self.read_group(confirmed_domain, ["amount_total:sum"], [])
        confirmed_amount = confirmed_groups[0]["amount_total"] if confirmed_groups else 0.0

        confirmed_count = sum(
            counts.get(s, 0) for s in self._DASHBOARD_CONFIRMED_STATES
        )
        avg_order = confirmed_amount / confirmed_count if confirmed_count else 0.0

        currency = self.env.company.currency_id

        # --- Distribución por estado (para gráfico) ----------------------------
        by_state = [
            {"key": key, "label": label, "value": counts[key]}
            for key, label in state_labels.items()
        ]

        # --- Top 10 productos vendidos (sale.order.line) -----------------------
        line_domain = [("order_id.state", "in", self._DASHBOARD_CONFIRMED_STATES)]
        if rng:
            line_domain += [
                ("order_id.date_order", ">=", start_dt),
                ("order_id.date_order", "<", end_dt),
            ]
        line_domain += [("product_id", "!=", False), ("display_type", "=", False)]
        product_groups = self.env["sale.order.line"].read_group(
            line_domain, ["product_id", "price_subtotal:sum"], ["product_id"]
        )
        by_product = sorted(
            [
                {
                    "id": g["product_id"][0],
                    "name": g["product_id"][1],
                    "amount": g["price_subtotal"],
                }
                for g in product_groups
                if g.get("product_id")
            ],
            key=lambda x: x["amount"],
            reverse=True,
        )[:10]

        # --- Top 10 clientes ---------------------------------------------------
        customer_groups = self.read_group(
            confirmed_domain + [("partner_id", "!=", False)],
            ["partner_id", "amount_total:sum"],
            ["partner_id"],
        )
        by_customer = sorted(
            [
                {
                    "id": g["partner_id"][0],
                    "name": g["partner_id"][1],
                    "amount": g["amount_total"],
                }
                for g in customer_groups
                if g.get("partner_id")
            ],
            key=lambda x: x["amount"],
            reverse=True,
        )[:10]

        # --- Tendencia de ventas (montos confirmados, últimos 12 meses) --------
        today = fields.Date.context_today(self)
        first_of_month = today.replace(day=1)
        months, monthly_amounts = [], []
        for i in range(11, -1, -1):
            m_start = first_of_month - relativedelta(months=i)
            m_end = m_start + relativedelta(months=1)
            m_start_dt = fields.Datetime.to_string(datetime.combine(m_start, time.min))
            m_end_dt = fields.Datetime.to_string(datetime.combine(m_end, time.min))
            m_groups = self.read_group(
                [
                    ("date_order", ">=", m_start_dt),
                    ("date_order", "<", m_end_dt),
                    ("state", "in", self._DASHBOARD_CONFIRMED_STATES),
                ],
                ["amount_total:sum"],
                [],
            )
            months.append(m_start.strftime("%m/%Y"))
            monthly_amounts.append(m_groups[0]["amount_total"] if m_groups else 0.0)

        return {
            "kpis": {
                "total_orders": total_orders,
                "draft": counts.get("draft", 0),
                "sent": counts.get("sent", 0),
                "sale": counts.get("sale", 0),
                "done": counts.get("done", 0),
                "cancel": counts.get("cancel", 0),
                "total_amount": total_amount,
                "confirmed_amount": confirmed_amount,
                "avg_order": avg_order,
            },
            "by_state": by_state,
            "by_product": by_product,
            "by_customer": by_customer,
            "trend": {"labels": months, "values": monthly_amounts},
            "currency": {"symbol": currency.symbol, "position": currency.position},
            "period": period,
            "active_domain": active_domain,
        }
