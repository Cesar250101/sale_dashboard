{
    'name': 'Tablero de Ventas',
    'version': '16.0.1.0.0',
    'category': 'Sales/Sales',
    'summary': 'Dashboard analítico para órdenes de venta (sale.order)',
    'description': """
Tablero de Ventas
=================
Agrega un menú *Dashboard* como primer elemento del módulo Ventas y lo muestra
por defecto al ingresar al módulo. Presenta KPIs, montos y gráficos de las
órdenes de venta con la paleta corporativa de Method.
""",
    'author': 'Method',
    'website': 'https://method.cl',
    'depends': ['sale', 'web'],
    'data': [
        'views/sale_dashboard_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'sale_dashboard/static/src/scss/sale_dashboard.scss',
            'sale_dashboard/static/src/js/sale_dashboard.js',
            'sale_dashboard/static/src/xml/sale_dashboard.xml',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
