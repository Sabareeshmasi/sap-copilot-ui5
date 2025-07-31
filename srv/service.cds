using NorthwindService from '../db/data-model';


service CatalogService @(path: '/odata/v4/catalog') {

  entity Products  as projection on NorthwindService.Products;
  entity Customers as projection on NorthwindService.Customers;
  entity Orders    as projection on NorthwindService.Orders;

}
