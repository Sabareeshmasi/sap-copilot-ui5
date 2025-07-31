using NorthwindService from '../db/data-model';

service CatalogService @(path: '/odata/v4/catalog') {

  entity Products as projection on NorthwindService.Products;
  entity Customers as projection on NorthwindService.Customers;
  entity Orders as projection on NorthwindService.Orders;
  entity Categories as projection on NorthwindService.Categories;
  entity Suppliers as projection on NorthwindService.Suppliers;
  entity OrderDetails as projection on NorthwindService.OrderDetails;

  // Add some calculated fields and views
  view ProductsWithCategory as select from NorthwindService.Products as p
    left join NorthwindService.Categories as c on p.CategoryID = c.ID {
      key p.ID,
      p.ProductName,
      p.UnitPrice,
      p.UnitsInStock,
      p.Discontinued,
      c.CategoryName,
      p.Description
    };

  view OrderSummary as select from NorthwindService.Orders as o
    left join NorthwindService.Customers as c on o.CustomerID = c.ID {
      key o.ID as OrderID,
      o.OrderDate,
      o.Status,
      o.Freight,
      c.CompanyName as CustomerName,
      c.City as CustomerCity,
      c.Country as CustomerCountry
    };

}
