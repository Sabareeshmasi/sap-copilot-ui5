using external from './external/Northwind_';

service NorthwindService {
  @path: '/Products'
  entity Products as projection on external.Products;

  @path: '/Customers'
  entity Customers as projection on external.Customers;

  @path: '/Orders'
  entity Orders as projection on external.Orders;
}
