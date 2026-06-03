from django.urls import path

from . import views


urlpatterns = [
    path("health", views.health),
    path("state", views.state),
    path("auth/gmail", views.login),
    path("auth/logout", views.logout),
    path("auth/extend", views.extend_session),
    path("auth/role", views.switch_role),
    path("payments/config", views.payment_config),
    path("<str:resource>", views.collection),
    path("<str:resource>/<str:item_id>", views.item),
    path("<str:resource>/<str:item_id>/<str:action>", views.action),
]
