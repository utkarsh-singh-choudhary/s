def test_health_and_auth(client, auth, machine):
    assert client.get("/api/machines").status_code == 401
    r = client.get("/api/machines", headers=auth("viewer"))
    assert r.status_code == 200
