import { QueueInstance } from "../classes/QueueInstance";
import { OrderMessage } from "../../definitions/messages/OrderMessage";
import { OrdersDatabase } from "../../databases/OrdersDatabase";
import { OrderStatus } from "../../definitions/enums/OrderStatus";
import { EmailService } from "../../services/email/EmailService";

const { SQS_ORDER_CANCELLATION_QUEUE_NAME } = process.env;

export class OrderCancellationInstance extends QueueInstance<OrderMessage> {
  constructor() {
    super({ loggerPrefix: "OrderCancellationInstance", queueName: SQS_ORDER_CANCELLATION_QUEUE_NAME });
  }

  protected getRequiredMessageFields(): Array<keyof OrderMessage> {
    return ["orderId"];
  }

  /**
   * Email the customer that their order was cancelled.
   * @param message
   * @protected
   */
  protected async process({ orderId }: OrderMessage): Promise<void> {
    const order = await OrdersDatabase.getOrderById(orderId);

    if (!order) throw new Error(`Order not found: ${orderId}`);
    if (order.status !== OrderStatus.CANCELLED) {
      this.logger.warn(`Order ${orderId} is not in CANCELLED state`);
      return;
    }

    // Customer details are generated at intake, so an order cancelled before intake has no email address.
    if (!order.details) {
      this.logger.warn(`Order ${orderId} has no customer details, skipping cancellation email`);
      return;
    }

    await EmailService.sendCancellationEmail(order);
    this.logger.info(`Order ${orderId} cancellation email sent`);
  }
}
