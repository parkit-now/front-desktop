import asyncio

import main


def test_sse_message_serializa_evento_y_data():
    message = main._sse_message("detection", {"id": "event-1", "displayPlate": "AA 123 BB"})

    assert message.startswith("event: detection\n")
    assert 'data: {"id":"event-1","displayPlate":"AA 123 BB"}\n\n' in message


def test_broadcaster_publica_a_los_suscriptores():
    async def run():
        broadcaster = main.DetectionEventBroadcaster()
        queue = broadcaster.subscribe()
        try:
            broadcaster.publish({"id": "event-1"})
            return await asyncio.wait_for(queue.get(), timeout=0.1)
        finally:
            broadcaster.unsubscribe(queue)

    assert asyncio.run(run()) == {"id": "event-1"}


def test_broadcaster_descarta_suscriptores_lentos():
    async def run():
        broadcaster = main.DetectionEventBroadcaster()
        queue = broadcaster.subscribe()
        try:
            for index in range(101):
                broadcaster.publish({"id": f"event-{index}"})
            return queue in broadcaster._subscribers
        finally:
            broadcaster.unsubscribe(queue)

    assert asyncio.run(run()) is False


def test_flush_settled_clusters_publica_evento(monkeypatch):
    async def run():
        queue = main._detection_events.subscribe()
        try:
            event = {"id": "event-1", "status": "pending"}
            monkeypatch.setattr(main, "_persist_cluster", lambda cluster: event)
            main._clusters[:] = [{"first_seen": 0.0, "last_seen": 0.0}]

            assert main._flush_settled_clusters(main.CLUSTER_SETTLE + 1.0) == [event]
            return await asyncio.wait_for(queue.get(), timeout=0.1)
        finally:
            main._detection_events.unsubscribe(queue)

    assert asyncio.run(run()) == {"id": "event-1", "status": "pending"}
