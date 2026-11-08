import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { OrderDetailsFactory } from "../../definitions/entities/OrderDetails";
import { SimpleQueueService } from "../../services/sqs/SimpleQueueService";

const { SQS_ORDER_INTAKE_QUEUE_NAME, SQS_ORDER_PROCESSING_QUEUE_NAME } = process.env;

export class OrderIntakeInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderIntakeInstance", queueName: SQS_ORDER_INTAKE_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Generate random order details and update the order in the database.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    const order = await OrdersDatabase.getOrderById(orderId);

    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status !== OrderStatus.PROCESSING) {
      this.logger.warn(`Order ${orderId} is not in PROCESSING state`);
      return;
    }

    if (order.details) {
      this.logger.warn(`Order ${orderId} already has details`);
      return;
    }

    const details = OrderDetailsFactory.create();

    // Total is derived from the generated items so the receipt total matches the items total price.
    const total = details.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const amount = Math.round(total * 100) / 100;

    await OrdersDatabase.update(order.orderId, { details, amount });

    this.logger.info(`Order ${orderId} details updated`);
    await SimpleQueueService.sendMessage(SQS_ORDER_PROCESSING_QUEUE_NAME, "Process a receipt from intake", { orderId });
  }
}
