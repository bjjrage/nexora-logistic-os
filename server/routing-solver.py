"""Private OR-Tools process. JSON on stdin/stdout; no database or network access."""
import json
import sys
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

def solve(data):
    orders, fleet, matrix = data['orders'], data['fleet'], data['matrix']
    manager = pywrapcp.RoutingIndexManager(len(matrix), len(fleet), 0)
    routing = pywrapcp.RoutingModel(manager)
    def travel(a, b):
        i, j = manager.IndexToNode(a), manager.IndexToNode(b)
        return int(matrix[i][j]) + (orders[i-1]['serviceSeconds'] if i else 0)
    transit = routing.RegisterTransitCallback(travel)
    routing.SetArcCostEvaluatorOfAllVehicles(transit)
    routing.AddDimension(transit, data['horizon'], data['horizon'], False, 'Time')
    time = routing.GetDimensionOrDie('Time')
    for v in range(len(fleet)):
        time.CumulVar(routing.Start(v)).SetRange(0, 0)
        routing.AddVariableMinimizedByFinalizer(time.CumulVar(routing.End(v)))
    for key, limit in [('weight', 'capacityWeight'), ('volume', 'capacityVolume')]:
        callback = routing.RegisterUnaryTransitCallback(lambda index, k=key: int(orders[manager.IndexToNode(index)-1][k]) if manager.IndexToNode(index) else 0)
        routing.AddDimensionWithVehicleCapacity(callback, 0, [int(v[limit]) for v in fleet], True, key)
    for n, order in enumerate(orders, 1):
        index = manager.NodeToIndex(n)
        time.CumulVar(index).SetRange(*order['window'])
        routing.AddDisjunction([index], 10000000)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = 3
    result = routing.SolveWithParameters(params)
    if not result:
        return {'routes': [], 'unassigned': [o['id'] for o in orders]}
    routes, assigned = [], set()
    for v in range(len(fleet)):
        index, stops = routing.Start(v), []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node:
                order = orders[node-1]
                stops.append({'orderId': order['id'], 'arrivalSeconds': result.Value(time.CumulVar(index))})
                assigned.add(order['id'])
            index = result.Value(routing.NextVar(index))
        if stops:
            routes.append({'vehicleId':fleet[v]['vehicleId'], 'driverId':fleet[v]['driverId'], 'stops':stops, 'durationSeconds':result.Value(time.CumulVar(index))})
    return {'routes':routes, 'unassigned':[o['id'] for o in orders if o['id'] not in assigned]}

if __name__ == '__main__':
    print(json.dumps(solve(json.load(sys.stdin))))
