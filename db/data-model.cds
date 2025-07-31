namespace NorthwindService;

entity Products {
  key ID : Integer;
  ProductName : String(100);
  QuantityPerUnit : String(50);
  UnitPrice : Decimal(10,2);
  UnitsInStock : Integer;
  UnitsOnOrder : Integer;
  ReorderLevel : Integer;
  Discontinued : Boolean;
  CategoryID : Integer;
  SupplierID : Integer;
  Description : String(500);
  CreatedAt : Timestamp;
  ModifiedAt : Timestamp;
}

entity Customers {
  key ID : Integer;
  CompanyName : String(100);
  ContactName : String(50);
  ContactTitle : String(50);
  Address : String(100);
  City : String(50);
  Region : String(50);
  PostalCode : String(20);
  Country : String(50);
  Phone : String(30);
  Fax : String(30);
  Email : String(100);
  CreatedAt : Timestamp;
  ModifiedAt : Timestamp;
}

entity Orders {
  key ID : Integer;
  CustomerID : Integer;
  EmployeeID : Integer;
  OrderDate : Date;
  RequiredDate : Date;
  ShippedDate : Date;
  ShipVia : Integer;
  Freight : Decimal(10,2);
  ShipName : String(100);
  ShipAddress : String(100);
  ShipCity : String(50);
  ShipRegion : String(50);
  ShipPostalCode : String(20);
  ShipCountry : String(50);
  Status : String(20);
  CreatedAt : Timestamp;
  ModifiedAt : Timestamp;
}

entity Categories {
  key ID : Integer;
  CategoryName : String(50);
  Description : String(500);
  Picture : LargeBinary;
  CreatedAt : Timestamp;
  ModifiedAt : Timestamp;
}

entity Suppliers {
  key ID : Integer;
  CompanyName : String(100);
  ContactName : String(50);
  ContactTitle : String(50);
  Address : String(100);
  City : String(50);
  Region : String(50);
  PostalCode : String(20);
  Country : String(50);
  Phone : String(30);
  Fax : String(30);
  HomePage : String(200);
  CreatedAt : Timestamp;
  ModifiedAt : Timestamp;
}

entity OrderDetails {
  key OrderID : Integer;
  key ProductID : Integer;
  UnitPrice : Decimal(10,2);
  Quantity : Integer;
  Discount : Decimal(3,2);
}
