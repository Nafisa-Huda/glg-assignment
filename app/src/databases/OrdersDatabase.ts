import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

import { Order } from "../definitions/entities/Order";
import { OrderStatus } from "../definitions/enums/OrderStatus";
import { DynamoService } from "../services/dynamo/DynamoService";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface GetOrdersParams {
  userId?: string;
  status?: OrderStatus;
  referenceId?: string;
  count: number;
}

const { DYNAMO_TABLE_ORDERS } = process.env;

export class OrdersDatabase {
  public static async createOrder(order: Order): Promise<void> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new PutItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Item: marshall(order, { removeUndefinedValues: true }),
    });

    await client.send(command);
  }

  public static async getOrders(params: GetOrdersParams): Promise<Order[]> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const { count } = params;

    /* Build filter expression */
    const filterExpression: Array<string> = [];
    const expressionAttributeValues = {};

    const filters = ['userId', 'status', 'referenceId'];
    for (const filter of filters) {
      if (params[filter]) {
        filterExpression.push(`#${filter} = :${filter}`);
        expressionAttributeValues[`:${filter}`] = { S: params[filter] };
      }
    }

    const command = new ScanCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Limit: count,
      FilterExpression: filterExpression.length > 0 ? filterExpression.join(" AND ") : undefined,
      ExpressionAttributeValues: filterExpression.length > 0 ? expressionAttributeValues : undefined,
      Select: "ALL_ATTRIBUTES"
    });

    const response = await client.send(command);
    if (!response.Items) return [];

    return response.Items.map((item) => unmarshall(item) as Order);
  }

  public static async getOrderById(orderId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new GetItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
    });

    const response = await client.send(command);
    if (!response.Item) return null;
    return unmarshall(response.Item) as Order;
  }

  public static async getOrderByReferenceId(referenceId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new QueryCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      IndexName: "referenceIdIndex",
      KeyConditionExpression: "referenceId = :referenceId",
      ExpressionAttributeValues: {
        ":referenceId": referenceId,
      },
      Select: "ALL_ATTRIBUTES",
      Limit: 1,
    });

    const response = await client.send(command);
    if (!response.Items || response.Items.length === 0) return null;
    return response.Items[0] as Order;
  }

  // Cancels the order only if it's still processing, otherwise returns null.
  public static async cancelOrder(orderId: string): Promise<Order | null> {
    const client = DynamoService.getClient();
    if (!DYNAMO_TABLE_ORDERS) throw new Error("DYNAMO_TABLE_ORDERS is not defined");

    const command = new UpdateItemCommand({
      TableName: DYNAMO_TABLE_ORDERS,
      Key: { orderId: { S: orderId } },
      UpdateExpression: "set #status = :status, updatedAt = :updatedAt",
      ConditionExpression: "#status = :processing",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": { S: OrderStatus.CANCELLED },
        ":processing": { S: OrderStatus.PROCESSING },
        ":updatedAt": { N: `${Date.now()}` },
      },
      ReturnValues: "ALL_NEW",
    });

    try {
      const response = await client.send(command);
      return unmarshall(response.Attributes!) as Order;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }
}
